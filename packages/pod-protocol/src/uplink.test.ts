import { describe, expect, it } from 'vitest';

import { toHex } from './bytes.js';
import {
  LIVE_PACKET_LENGTH,
  LIVE_PACKET_NO_POSITION_LENGTH,
  SLOT_REQUEST_PACKET_LENGTH,
  UPLINK_HEADER_LENGTH,
} from './constants.js';
import { nobleCcmProvider } from './crypto.js';
import { PodProtocolError, type PodProtocolErrorCode } from './errors.js';
import { linkNonce } from './nonce.js';
import { emptyReplayState } from './replay.js';
import { nodeCcmProvider } from './testing/node-ccm.js';
import { SAMPLE_LIVE_SUMMARY } from './testing/samples.js';
import {
  decodeLivePayload,
  decodeUplinkHeader,
  encodeLivePayload,
  encodeUplinkHeader,
  openUplink,
  receiveUplink,
  sealUplink,
  type LiveSummary,
} from './uplink.js';

const key = new Uint8Array(16).map((_, i) => i * 17);
const base = { networkId: 0x0a51, podShortId: 23, keyId: 2, key };

async function expectCode(promise: Promise<unknown>, code: PodProtocolErrorCode): Promise<void> {
  await expect(promise).rejects.toSatisfy(
    (error: unknown) => error instanceof PodProtocolError && error.code === code,
  );
}

function expectCodeSync(fn: () => unknown, code: PodProtocolErrorCode): void {
  try {
    fn();
  } catch (error) {
    expect(error).toBeInstanceOf(PodProtocolError);
    expect((error as PodProtocolError).code).toBe(code);
    return;
  }
  expect.fail(`expected ${code}`);
}

describe('uplink header', () => {
  it('lays out version|type, network, pod, key id, boot low 16 and frame little-endian', () => {
    const header = encodeUplinkHeader({
      type: 'live_summary',
      networkId: 0x0a51,
      podShortId: 0x0017,
      keyId: 2,
      bootCounterLow16: 0x1234,
      frameNumber: 0xbeef,
    });
    expect(toHex(header)).toBe('11510a1700023412efbe');
  });

  it('rejects other versions, unknown types and lengths that do not match the type', () => {
    const packet = new Uint8Array(LIVE_PACKET_LENGTH);
    packet[0] = 0x21;
    expectCodeSync(() => decodeUplinkHeader(packet), 'unsupported_version');
    packet[0] = 0x17;
    expectCodeSync(() => decodeUplinkHeader(packet), 'unknown_type');
    packet[0] = 0x18;
    expectCodeSync(() => decodeUplinkHeader(packet), 'unknown_type');
    packet[0] = 0x12;
    expectCodeSync(() => decodeUplinkHeader(packet), 'invalid_length');
    expectCodeSync(() => decodeUplinkHeader(packet.subarray(0, 5)), 'invalid_length');
  });
});

describe('live payload', () => {
  it('is 37 B with positions and 29 B without, and round-trips', () => {
    const withPosition = encodeLivePayload(SAMPLE_LIVE_SUMMARY, { withPosition: true });
    expect(withPosition).toHaveLength(37);
    expect(decodeLivePayload(withPosition, { withPosition: true })).toEqual(SAMPLE_LIVE_SUMMARY);

    const noPosition: LiveSummary = {
      ...SAMPLE_LIVE_SUMMARY,
      seconds: [
        { ...SAMPLE_LIVE_SUMMARY.seconds[0], positionDm: null },
        { ...SAMPLE_LIVE_SUMMARY.seconds[1], positionDm: null },
      ],
    };
    const without = encodeLivePayload(noPosition, { withPosition: false });
    expect(without).toHaveLength(29);
    expect(decodeLivePayload(without, { withPosition: false })).toEqual(noPosition);
  });

  it('packs the status word as battery[15..9] vest[8] fix[7..5] reserved[4..0]', () => {
    const payload = encodeLivePayload(SAMPLE_LIVE_SUMMARY, { withPosition: true });
    const status = (payload[0] ?? 0) | ((payload[1] ?? 0) << 8);
    expect(status >>> 9).toBe(87);
    expect((status >>> 8) & 1).toBe(1);
    expect((status >>> 5) & 7).toBe(3);
    expect(status & 0x1f).toBe(0);
  });

  it('round-trips the "no value" sentinels as null', () => {
    const summary: LiveSummary = {
      ...SAMPLE_LIVE_SUMMARY,
      batteryPct: null,
      fixQuality: 'no_fix',
      seconds: [
        { vmaxCmS: null, distanceDm: null, positionDm: null },
        { vmaxCmS: 0, distanceDm: 0, positionDm: { xDm: -32_767, yDm: 32_767 } },
      ],
    };
    expect(
      decodeLivePayload(encodeLivePayload(summary, { withPosition: true }), { withPosition: true }),
    ).toEqual(summary);
  });

  it('rejects values that do not fit, sentinels as values and positions without the position type', () => {
    const cases: Partial<LiveSummary>[] = [
      { batteryPct: 101 },
      { sessionDistanceDm: 2 ** 24 },
      { accelLoadCentiAu: -1 },
      { impactsN: 1.5 },
      { configVersion: 256 },
      { speedBandDistancesM: [0, 0, 0, 65_536] },
      {
        seconds: [
          { vmaxCmS: 0xffff, distanceDm: 1, positionDm: null },
          SAMPLE_LIVE_SUMMARY.seconds[1],
        ],
      },
      {
        seconds: [
          { vmaxCmS: 1, distanceDm: 255, positionDm: null },
          SAMPLE_LIVE_SUMMARY.seconds[1],
        ],
      },
      {
        seconds: [
          { vmaxCmS: 1, distanceDm: 1, positionDm: { xDm: -32_768, yDm: 0 } },
          SAMPLE_LIVE_SUMMARY.seconds[1],
        ],
      },
    ];
    for (const patch of cases) {
      expectCodeSync(
        () => encodeLivePayload({ ...SAMPLE_LIVE_SUMMARY, ...patch }, { withPosition: true }),
        'field_out_of_range',
      );
    }
    expectCodeSync(
      () => encodeLivePayload(SAMPLE_LIVE_SUMMARY, { withPosition: false }),
      'field_out_of_range',
    );
  });

  it('rejects reserved bits, fix quality 7, battery 101..126 and half positions on decode', () => {
    const good = encodeLivePayload(SAMPLE_LIVE_SUMMARY, { withPosition: true });
    const reserved = good.slice();
    reserved[0] = (reserved[0] ?? 0) | 0x01;
    expectCodeSync(() => decodeLivePayload(reserved, { withPosition: true }), 'reserved_bits_set');
    const fix7 = good.slice();
    fix7[0] = (fix7[0] ?? 0) | 0xe0;
    expectCodeSync(() => decodeLivePayload(fix7, { withPosition: true }), 'field_out_of_range');
    const battery = good.slice();
    battery[1] = (110 << 1) | 1;
    expectCodeSync(() => decodeLivePayload(battery, { withPosition: true }), 'field_out_of_range');
    const half = good.slice();
    half[28] = 0x00;
    half[29] = 0x80;
    expectCodeSync(() => decodeLivePayload(half, { withPosition: true }), 'field_out_of_range');
    expectCodeSync(
      () => decodeLivePayload(good.subarray(0, 36), { withPosition: true }),
      'invalid_length',
    );
  });
});

describe('sealed uplink', () => {
  it('is 51 B for a live summary, 43 B without positions and 14 B for a slot request', async () => {
    const live = await sealUplink({
      ...base,
      bootCounter: 70_000,
      frameNumber: 9,
      message: { type: 'live_summary', summary: SAMPLE_LIVE_SUMMARY },
    });
    expect(live).toHaveLength(LIVE_PACKET_LENGTH);
    expect(LIVE_PACKET_LENGTH).toBe(51);
    expect(LIVE_PACKET_NO_POSITION_LENGTH).toBe(43);
    const request = await sealUplink({
      ...base,
      bootCounter: 70_000,
      frameNumber: 10,
      message: { type: 'slot_request' },
    });
    expect(request).toHaveLength(SLOT_REQUEST_PACKET_LENGTH);
    expect(SLOT_REQUEST_PACKET_LENGTH).toBe(14);
  });

  it('uses the clear header as AAD and the link nonce, exactly as OpenSSL would', async () => {
    const packet = await sealUplink({
      ...base,
      bootCounter: 70_000,
      frameNumber: 9,
      message: { type: 'live_summary', summary: SAMPLE_LIVE_SUMMARY },
    });
    const header = packet.subarray(0, UPLINK_HEADER_LENGTH);
    const reference = await nodeCcmProvider.seal({
      key,
      nonce: linkNonce({ bootCounter: 70_000, frameNumber: 9, direction: 'uplink' }),
      aad: header,
      plaintext: encodeLivePayload(SAMPLE_LIVE_SUMMARY, { withPosition: true }),
      tagLength: 4,
    });
    expect(toHex(packet.subarray(UPLINK_HEADER_LENGTH))).toBe(toHex(reference));
    // 16 low bits of 70 000 = 0x1170.
    expect(toHex(header.subarray(6, 8))).toBe('7011');
  });

  it('opens what it seals and fails the MIC on any change of header, payload, key or boot counter', async () => {
    const packet = await sealUplink({
      ...base,
      bootCounter: 70_000,
      frameNumber: 9,
      message: { type: 'live_summary', summary: SAMPLE_LIVE_SUMMARY },
    });
    const opened = await openUplink({ packet, bootCounter: 70_000, key, crypto: nodeCcmProvider });
    expect(opened.message).toEqual({ type: 'live_summary', summary: SAMPLE_LIVE_SUMMARY });

    for (const index of [1, 3, 5, 9, 20, 50]) {
      const tampered = packet.slice();
      tampered[index] = (tampered[index] ?? 0) ^ 0x40;
      await expectCode(
        openUplink({ packet: tampered, bootCounter: 70_000, key }),
        'authentication_failed',
      );
    }
    await expectCode(
      openUplink({ packet, bootCounter: 70_000, key: key.map((b) => b ^ 1) }),
      'authentication_failed',
    );
    // Same 16 low bits, different high bits → different nonce.
    await expectCode(
      openUplink({ packet, bootCounter: 70_000 + 0x10000, key }),
      'authentication_failed',
    );
    await expectCode(openUplink({ packet, bootCounter: 70_001, key }), 'field_out_of_range');
  });
});

describe('receiveUplink', () => {
  async function live(bootCounter: number, frameNumber: number): Promise<Uint8Array> {
    return sealUplink({
      ...base,
      bootCounter,
      frameNumber,
      message: { type: 'live_summary', summary: SAMPLE_LIVE_SUMMARY },
    });
  }

  it('accepts newer frames, rejects replays and keeps the state untouched on rejection', async () => {
    const keyFor = () => key;
    const first = await receiveUplink({
      packet: await live(70_000, 9),
      replay: emptyReplayState(),
      keyFor,
      bootCounterHint: () => 69_990,
    });
    expect(first.bootCounter).toBe(70_000);
    expect(first.replay.entries['23/2']).toEqual({ bootCounter: 70_000, frameNumber: 9 });

    await expectCode(
      receiveUplink({ packet: await live(70_000, 9), replay: first.replay, keyFor }),
      'replay',
    );
    await expectCode(
      receiveUplink({ packet: await live(70_000, 8), replay: first.replay, keyFor }),
      'replay',
    );
    await expectCode(
      receiveUplink({ packet: await live(69_999, 100), replay: first.replay, keyFor }),
      'replay',
    );

    const next = await receiveUplink({
      packet: await live(70_000, 10),
      replay: first.replay,
      keyFor,
    });
    // New boot, frame restarts at 0.
    const reboot = await receiveUplink({
      packet: await live(70_001, 0),
      replay: next.replay,
      keyFor,
    });
    expect(reboot.replay.entries['23/2']).toEqual({ bootCounter: 70_001, frameNumber: 0 });
  });

  it('rebuilds the high bits across a 16-bit wrap of the boot counter', async () => {
    const keyFor = () => key;
    const before = await receiveUplink({
      packet: await live(0x1_ffff, 3),
      replay: emptyReplayState(),
      keyFor,
      bootCounterHint: () => 0x1_fff0,
    });
    const after = await receiveUplink({
      packet: await live(0x2_0000, 0),
      replay: before.replay,
      keyFor,
    });
    expect(after.bootCounter).toBe(0x2_0000);
  });

  it('does not record a frame whose MIC fails, so a forged header cannot burn the window', async () => {
    const keyFor = () => key;
    const forged = await live(70_000, 9);
    forged[forged.length - 1] = (forged[forged.length - 1] ?? 0) ^ 1;
    const replay = emptyReplayState();
    await expectCode(
      receiveUplink({ packet: forged, replay, keyFor, bootCounterHint: () => 70_000 }),
      'authentication_failed',
    );
    expect(replay.entries).toEqual({});
  });

  it('reports a pod or epoch without a key', async () => {
    await expectCode(
      receiveUplink({
        packet: await live(1, 1),
        replay: emptyReplayState(),
        keyFor: () => undefined,
      }),
      'invalid_key',
    );
  });

  it('uses the default provider when none is given', async () => {
    const packet = await sealUplink({
      ...base,
      bootCounter: 1,
      frameNumber: 1,
      message: { type: 'slot_request' },
      crypto: nobleCcmProvider,
    });
    const opened = await receiveUplink({ packet, replay: emptyReplayState(), keyFor: () => key });
    expect(opened.message).toEqual({ type: 'slot_request' });
  });
});
