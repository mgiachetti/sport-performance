import { readFileSync, writeFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { loraTimeOnAirMs } from './airtime.js';
import { fromHex, toHex } from './bytes.js';
import { CCM_TAG_LENGTH, LIVE_RADIO, UPLINK_HEADER_LENGTH } from './constants.js';
import { reconstructBootCounter } from './counters.js';
import {
  deriveBeaconKey,
  deriveLinkKey,
  deriveStorageKey,
  kdfInfo,
  nobleCcmProvider,
  type KdfLabel,
} from './crypto.js';
import {
  encodeBeaconBody,
  openBeacon,
  openRtcmFragment,
  sealBeacon,
  sealRtcmFragment,
  type Beacon,
} from './downlink.js';
import { PodProtocolError, type PodProtocolErrorCode } from './errors.js';
import { downlinkNonce, linkNonce } from './nonce.js';
import { emptyReplayState, type ReplayState } from './replay.js';
import { nodeCcmProvider } from './testing/node-ccm.js';
import { SAMPLE_BEACON, SAMPLE_LIVE_SUMMARY } from './testing/samples.js';
import {
  encodeLivePayload,
  encodeUplinkHeader,
  openUplink,
  receiveUplink,
  sealUplink,
  type LiveSummary,
  type UplinkMessage,
} from './uplink.js';

/**
 * Golden vectors (`fixtures/v1/vectors.json`) shared with the firmware (C) and
 * any other implementation. This test regenerates them from the definitions
 * below and fails if the committed file differs; to change them on purpose:
 * `pnpm --filter @sport-performance/pod-protocol fixtures:update`.
 */

const FIXTURE_PATH = new URL('../fixtures/v1/vectors.json', import.meta.url);

const MASTER_KEY = fromHex('000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f');
const DEVICE_ID = fromHex('8a1f3c5e7d902b46');
const GATEWAY_ID = fromHex('ac1f09fffe0a51c0');
const EPOCH = 2;
const LINK_KEY = deriveLinkKey({ masterKey: MASTER_KEY, deviceId: DEVICE_ID, epoch: EPOCH });
const BEACON_KEY = deriveBeaconKey({ masterKey: MASTER_KEY, gatewayId: GATEWAY_ID, epoch: EPOCH });
const NETWORK_ID = 0x0a51;
const POD_SHORT_ID = 23;

const NO_POSITION_SUMMARY: LiveSummary = {
  ...SAMPLE_LIVE_SUMMARY,
  batteryPct: null,
  vestOn: false,
  fixQuality: 'no_fix',
  seconds: [
    { vmaxCmS: null, distanceDm: null, positionDm: null },
    { vmaxCmS: 0, distanceDm: 0, positionDm: null },
  ],
};

const SATURATED_SUMMARY: LiveSummary = {
  batteryPct: 100,
  vestOn: true,
  fixQuality: 'rtk_fixed',
  sessionDistanceDm: 0xff_ffff,
  speedBandDistancesM: [0xffff, 0xffff, 0xffff, 0xffff],
  accelerationsN: 0xffff,
  decelerationsN: 0xffff,
  accelLoadCentiAu: 0xff_ffff,
  impactsN: 0xffff,
  seconds: [
    { vmaxCmS: 0xfffe, distanceDm: 0xfe, positionDm: { xDm: -32_767, yDm: 32_767 } },
    { vmaxCmS: 1, distanceDm: 1, positionDm: null },
  ],
  configVersion: 255,
};

interface UplinkCase {
  name: string;
  bootCounter: number;
  frameNumber: number;
  message: UplinkMessage;
}

const SAMPLE_CASE: UplinkCase = {
  name: 'live_summary_sample',
  bootCounter: 70_000,
  frameNumber: 9,
  message: { type: 'live_summary', summary: SAMPLE_LIVE_SUMMARY },
};

const UPLINK_CASES: UplinkCase[] = [
  SAMPLE_CASE,
  {
    name: 'live_summary_saturated',
    bootCounter: 0x0001_ffff,
    frameNumber: 0xffff,
    message: { type: 'live_summary', summary: SATURATED_SUMMARY },
  },
  {
    name: 'live_summary_no_position',
    bootCounter: 1,
    frameNumber: 0,
    message: { type: 'live_summary_no_position', summary: NO_POSITION_SUMMARY },
  },
  { name: 'slot_request', bootCounter: 70_001, frameNumber: 0, message: { type: 'slot_request' } },
];

const BEACON_CASES: { name: string; beacon: Beacon }[] = [
  { name: 'beacon_sample', beacon: SAMPLE_BEACON },
  {
    name: 'beacon_max_grants',
    beacon: {
      ...SAMPLE_BEACON,
      gnssTimeS: SAMPLE_BEACON.gnssTimeS + 2,
      sessionOpen: false,
      ledMode: 'off',
      sessionTransitionGnssS: null,
      grants: Array.from({ length: 9 }, (_, i) => ({
        action: i % 4 === 3 ? ('release' as const) : ('grant' as const),
        podShortId: 100 + i,
        channel: i % 8,
        slot: 1 + i,
      })),
    },
  },
];

const RTCM_CASE = {
  name: 'rtcm_fragment_1_of_3',
  fragment: {
    networkId: NETWORK_ID,
    gnssTimeS: SAMPLE_BEACON.gnssTimeS,
    keyId: EPOCH,
    fragmentIndex: 1,
    fragmentCount: 3,
    // Start of an RTCM3 frame (preamble 0xD3) then filler.
    data: Uint8Array.from({ length: 64 }, (_, i) => (i === 0 ? 0xd3 : (i * 37) & 0xff)),
  },
};

async function sealCase(c: UplinkCase): Promise<Uint8Array> {
  return sealUplink({
    message: c.message,
    networkId: NETWORK_ID,
    podShortId: POD_SHORT_ID,
    keyId: EPOCH,
    bootCounter: c.bootCounter,
    frameNumber: c.frameNumber,
    key: LINK_KEY,
  });
}

function plaintextOf(message: UplinkMessage): string {
  return message.type === 'slot_request'
    ? ''
    : toHex(encodeLivePayload(message.summary, { withPosition: message.type === 'live_summary' }));
}

async function rejection(name: string, packet: Uint8Array, bootCounter: number, why: string) {
  let code: PodProtocolErrorCode | undefined;
  try {
    await openUplink({ packet, bootCounter, key: LINK_KEY });
  } catch (error) {
    if (error instanceof PodProtocolError) {
      code = error.code;
    } else {
      throw error;
    }
  }
  return { name, why, packetHex: toHex(packet), bootCounter, error: code ?? 'accepted' };
}

async function buildVectors() {
  const kdf = (['uplink', 'storage', 'beacon'] as KdfLabel[]).map((label) => {
    const id = label === 'beacon' ? GATEWAY_ID : DEVICE_ID;
    const key =
      label === 'uplink'
        ? LINK_KEY
        : label === 'storage'
          ? deriveStorageKey({ masterKey: MASTER_KEY, deviceId: DEVICE_ID, epoch: EPOCH })
          : BEACON_KEY;
    return {
      label,
      idHex: toHex(id),
      epoch: EPOCH,
      infoHex: toHex(kdfInfo(label, id, EPOCH)),
      keyHex: toHex(key),
    };
  });

  const uplink = [];
  for (const c of UPLINK_CASES) {
    const packet = await sealCase(c);
    uplink.push({
      name: c.name,
      bootCounter: c.bootCounter,
      frameNumber: c.frameNumber,
      message: c.message,
      nonceHex: toHex(
        linkNonce({ bootCounter: c.bootCounter, frameNumber: c.frameNumber, direction: 'uplink' }),
      ),
      headerHex: toHex(packet.subarray(0, UPLINK_HEADER_LENGTH)),
      plaintextHex: plaintextOf(c.message),
      packetHex: toHex(packet),
    });
  }

  const beacon = [];
  for (const c of BEACON_CASES) {
    const packet = await sealBeacon({ beacon: c.beacon, key: BEACON_KEY });
    beacon.push({
      name: c.name,
      beacon: c.beacon,
      nonceHex: toHex(
        downlinkNonce({
          networkId: c.beacon.networkId,
          gnssTimeS: c.beacon.gnssTimeS,
          typeByte: 0x18,
          fragmentIndex: 0,
        }),
      ),
      plaintextHex: toHex(encodeBeaconBody(c.beacon)),
      packetHex: toHex(packet),
    });
  }

  const rtcmPacket = await sealRtcmFragment({ fragment: RTCM_CASE.fragment, key: BEACON_KEY });
  const rtcm = [
    {
      name: RTCM_CASE.name,
      fragment: (({ data, ...rest }) => ({ ...rest, dataHex: toHex(data) }))(RTCM_CASE.fragment),
      nonceHex: toHex(
        downlinkNonce({
          networkId: NETWORK_ID,
          gnssTimeS: RTCM_CASE.fragment.gnssTimeS,
          typeByte: 0x1a,
          fragmentIndex: RTCM_CASE.fragment.fragmentIndex,
        }),
      ),
      packetHex: toHex(rtcmPacket),
    },
  ];

  // Rejections: what every receiver must refuse, and with which code.
  const sample = await sealCase(SAMPLE_CASE);
  const badMic = sample.slice();
  badMic[badMic.length - 1] = (badMic[badMic.length - 1] ?? 0) ^ 0x01;
  const badHeader = sample.slice();
  badHeader[3] = (badHeader[3] ?? 0) ^ 0x01;
  const badVersion = sample.slice();
  badVersion[0] = 0x21;
  const reservedHeader = encodeUplinkHeader({
    type: 'live_summary',
    networkId: NETWORK_ID,
    podShortId: POD_SHORT_ID,
    keyId: EPOCH,
    bootCounterLow16: 70_000 % 0x10000,
    frameNumber: 10,
  });
  const reservedPlaintext = encodeLivePayload(SAMPLE_LIVE_SUMMARY, { withPosition: true });
  reservedPlaintext[0] = (reservedPlaintext[0] ?? 0) | 0x01;
  const reservedSealed = await nobleCcmProvider.seal({
    key: LINK_KEY,
    nonce: linkNonce({ bootCounter: 70_000, frameNumber: 10, direction: 'uplink' }),
    aad: reservedHeader,
    plaintext: reservedPlaintext,
    tagLength: CCM_TAG_LENGTH,
  });
  const rejections = [
    await rejection('mic_flipped', badMic, 70_000, 'last MIC bit flipped'),
    await rejection('header_flipped', badHeader, 70_000, 'pod short id changed: the header is AAD'),
    await rejection(
      'wrong_high_boot_bits',
      sample,
      70_000 + 0x10000,
      'same 16 low bits, other 32-bit boot counter',
    ),
    await rejection('bad_version', badVersion, 70_000, 'version nibble 2'),
    await rejection('truncated', sample.subarray(0, 50), 70_000, '50 B live summary'),
    await rejection(
      'reserved_status_bits',
      new Uint8Array([...reservedHeader, ...reservedSealed]),
      70_000,
      'valid MIC, reserved status bit set',
    ),
  ];

  // Receiver sequence: one pod, empty anti-replay state, server hint 0x1FFE0.
  // The last one jumps more than 32 768 boots: outside the reconstruction window.
  const sequenceInputs: [number, number][] = [
    [0x0001_fff0, 9],
    [0x0001_fff0, 9],
    [0x0001_fff0, 8],
    [0x0001_fff0, 10],
    [0x0001_ffef, 500],
    [0x0001_fff1, 0],
    [0x0001_ffff, 3],
    [0x0002_0000, 0],
    [0x0002_9000, 0],
  ];
  let replay: ReplayState = emptyReplayState();
  const receiveSequence = [];
  for (const [bootCounter, frameNumber] of sequenceInputs) {
    const packet = await sealCase({
      name: '',
      bootCounter,
      frameNumber,
      message: { type: 'slot_request' },
    });
    let result = 'accepted';
    try {
      const received = await receiveUplink({
        packet,
        replay,
        keyFor: () => LINK_KEY,
        bootCounterHint: () => 0x0001_ffe0,
      });
      replay = received.replay;
    } catch (error) {
      if (!(error instanceof PodProtocolError)) {
        throw error;
      }
      result = error.code;
    }
    receiveSequence.push({ packetHex: toHex(packet), bootCounter, frameNumber, result });
  }

  const bootCounterReconstruction = [
    { low16: 0x1235, reference: 0x0005_1234 },
    { low16: 0x0001, reference: 0x0005_fffe },
    { low16: 0xfffe, reference: 0x0006_0001 },
    { low16: 0x0007, reference: null },
  ].map((c) => ({ ...c, expected: reconstructBootCounter(c.low16, c.reference ?? undefined) }));

  const airtime = [51, 43, 48, 14, 255].map((payloadLengthB) => ({
    payloadLengthB,
    ...LIVE_RADIO,
    timeOnAirMs: Math.round(loraTimeOnAirMs(payloadLengthB) * 1000) / 1000,
  }));

  return {
    format: 'sport-performance/pod-protocol/vectors',
    protocolVersion: 1,
    readme: 'packages/pod-protocol/README.md',
    integers: 'little-endian',
    keys: {
      masterKeyHex: toHex(MASTER_KEY),
      deviceIdHex: toHex(DEVICE_ID),
      gatewayIdHex: toHex(GATEWAY_ID),
      epoch: EPOCH,
      linkKeyHex: toHex(LINK_KEY),
      beaconKeyHex: toHex(BEACON_KEY),
    },
    common: { networkId: NETWORK_ID, podShortId: POD_SHORT_ID, keyId: EPOCH },
    kdf,
    uplink,
    beacon,
    rtcm,
    rejections,
    receiveSequence,
    bootCounterReconstruction,
    airtime,
  };
}

type Vectors = Awaited<ReturnType<typeof buildVectors>>;

function serialise(vectors: Vectors): string {
  return `${JSON.stringify(vectors, null, 2)}\n`;
}

describe('golden fixtures v1', async () => {
  const generated = await buildVectors();
  if (process.env.POD_PROTOCOL_UPDATE_FIXTURES === '1') {
    writeFileSync(FIXTURE_PATH, serialise(generated));
  }

  it('the committed vectors match the implementation', () => {
    // Compared as data: the file is formatted by Prettier like the rest of the repo.
    const committed: unknown = JSON.parse(readFileSync(FIXTURE_PATH, 'utf8'));
    expect(committed).toEqual(JSON.parse(serialise(generated)));
  });

  // From here on, only the committed JSON is used: the same checks the firmware runs.
  const vectors = JSON.parse(readFileSync(FIXTURE_PATH, 'utf8')) as Vectors;
  const linkKey = fromHex(vectors.keys.linkKeyHex);
  const beaconKey = fromHex(vectors.keys.beaconKeyHex);

  it('KDF vectors derive with Node as well', async () => {
    const { hkdfSync } = await import('node:crypto');
    for (const v of vectors.kdf) {
      const key = new Uint8Array(
        hkdfSync(
          'sha256',
          fromHex(vectors.keys.masterKeyHex),
          new Uint8Array(0),
          fromHex(v.infoHex),
          16,
        ),
      );
      expect(toHex(key)).toBe(v.keyHex);
    }
  });

  it.each(vectors.uplink.map((v) => [v.name, v] as const))(
    'uplink %s opens with both providers',
    async (_, v) => {
      for (const crypto of [nobleCcmProvider, nodeCcmProvider]) {
        const opened = await openUplink({
          packet: fromHex(v.packetHex),
          bootCounter: v.bootCounter,
          key: linkKey,
          crypto,
        });
        expect(opened.message).toEqual(v.message);
      }
      expect(v.packetHex.startsWith(v.headerHex)).toBe(true);
    },
  );

  it.each(vectors.beacon.map((v) => [v.name, v] as const))('beacon %s opens', async (_, v) => {
    expect(
      await openBeacon({ packet: fromHex(v.packetHex), key: beaconKey, crypto: nodeCcmProvider }),
    ).toEqual(v.beacon);
  });

  it('RTCM fragment opens', async () => {
    for (const v of vectors.rtcm) {
      const opened = await openRtcmFragment({ packet: fromHex(v.packetHex), key: beaconKey });
      expect(toHex(opened.data)).toBe(v.fragment.dataHex);
      expect(opened.fragmentIndex).toBe(v.fragment.fragmentIndex);
    }
  });

  it('rejections have the expected codes', () => {
    expect(vectors.rejections.map((r) => [r.name, r.error])).toEqual([
      ['mic_flipped', 'authentication_failed'],
      ['header_flipped', 'authentication_failed'],
      ['wrong_high_boot_bits', 'authentication_failed'],
      ['bad_version', 'unsupported_version'],
      ['truncated', 'invalid_length'],
      ['reserved_status_bits', 'reserved_bits_set'],
    ]);
  });

  it('the receive sequence accepts, rejects replays, crosses a 16-bit boot wrap and refuses a jump past the window', () => {
    expect(vectors.receiveSequence.map((r) => r.result)).toEqual([
      'accepted',
      'replay',
      'replay',
      'accepted',
      'replay',
      'accepted',
      'accepted',
      'accepted',
      'replay',
    ]);
  });

  it('airtime of the live packet and the beacon', () => {
    expect(vectors.airtime.find((a) => a.payloadLengthB === 51)?.timeOnAirMs).toBe(102.656);
    expect(vectors.airtime.find((a) => a.payloadLengthB === 48)?.timeOnAirMs).toBe(97.536);
  });
});
