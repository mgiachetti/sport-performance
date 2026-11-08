import { describe, expect, it } from 'vitest';

import { loraTimeOnAirMs } from './airtime.js';
import { toHex } from './bytes.js';
import { BEACON_WINDOW_MS, MAX_BEACON_LENGTH, MAX_RTCM_FRAGMENT_BODY_LENGTH } from './constants.js';
import {
  decodeDownlinkHeader,
  encodeBeaconBody,
  openBeacon,
  openRtcmFragment,
  sealBeacon,
  sealRtcmFragment,
  type Beacon,
  type SlotGrant,
} from './downlink.js';
import { PodProtocolError, type PodProtocolErrorCode } from './errors.js';
import { downlinkNonce } from './nonce.js';
import { nodeCcmProvider } from './testing/node-ccm.js';
import { SAMPLE_BEACON } from './testing/samples.js';

const key = new Uint8Array(16).map((_, i) => 0xa0 + i);

async function expectCode(promise: Promise<unknown>, code: PodProtocolErrorCode): Promise<void> {
  await expect(promise).rejects.toSatisfy(
    (error: unknown) => error instanceof PodProtocolError && error.code === code,
  );
}

describe('beacon', () => {
  it('round-trips and is 21 + 3·N B', async () => {
    const packet = await sealBeacon({ beacon: SAMPLE_BEACON, key });
    expect(packet).toHaveLength(21 + 3 * SAMPLE_BEACON.grants.length);
    expect(await openBeacon({ packet, key, crypto: nodeCcmProvider })).toEqual(SAMPLE_BEACON);
    expect(decodeDownlinkHeader(packet)).toEqual({
      type: 'beacon',
      networkId: SAMPLE_BEACON.networkId,
      gnssTimeS: SAMPLE_BEACON.gnssTimeS,
      keyId: SAMPLE_BEACON.keyId,
    });
  });

  it('with the 9 grants allowed is 48 B and fits the 120 ms window (≈ 97,5 ms)', async () => {
    const grants: SlotGrant[] = Array.from({ length: 9 }, (_, i) => ({
      action: 'grant',
      podShortId: 100 + i,
      channel: i % 8,
      slot: 1 + i,
    }));
    const packet = await sealBeacon({ beacon: { ...SAMPLE_BEACON, grants }, key });
    expect(packet).toHaveLength(48);
    expect(MAX_BEACON_LENGTH).toBe(48);
    expect(loraTimeOnAirMs(packet.length)).toBeCloseTo(97.536, 3);
    expect(loraTimeOnAirMs(packet.length)).toBeLessThan(BEACON_WINDOW_MS);
    await expectCode(
      sealBeacon({
        beacon: {
          ...SAMPLE_BEACON,
          grants: [...grants, { action: 'grant', podShortId: 1, channel: 0, slot: 1 }],
        },
        key,
      }),
      'field_out_of_range',
    );
  });

  it('uses network ‖ GNSS time ‖ type byte ‖ fragment 0 as nonce and the header as AAD, as OpenSSL would', async () => {
    const packet = await sealBeacon({ beacon: SAMPLE_BEACON, key });
    const nonce = downlinkNonce({
      networkId: 0x0a51,
      gnssTimeS: SAMPLE_BEACON.gnssTimeS,
      typeByte: 0x18,
      fragmentIndex: 0,
    });
    expect(toHex(nonce)).toBe('510a803530561800' + '00'.repeat(5));
    expect(toHex(packet.subarray(0, 8))).toBe('18510a8035305602');
    const reference = await nodeCcmProvider.seal({
      key,
      nonce,
      aad: packet.subarray(0, 8),
      plaintext: encodeBeaconBody(SAMPLE_BEACON),
      tagLength: 4,
    });
    expect(toHex(packet.subarray(8))).toBe(toHex(reference));
  });

  it('rejects slot 0, channel 8, odd frame times, reserved LED mode and tampering', async () => {
    const bad: Partial<Beacon>[] = [
      { grants: [{ action: 'grant', podShortId: 1, channel: 0, slot: 0 }] },
      { grants: [{ action: 'grant', podShortId: 1, channel: 8, slot: 1 }] },
      { grants: [{ action: 'grant', podShortId: 1, channel: 0, slot: 16 }] },
      { gnssTimeS: SAMPLE_BEACON.gnssTimeS + 1 },
      { sessionTransitionGnssS: 0 },
      { configVersion: 300 },
    ];
    for (const patch of bad) {
      await expectCode(
        sealBeacon({ beacon: { ...SAMPLE_BEACON, ...patch }, key }),
        'field_out_of_range',
      );
    }
    const packet = await sealBeacon({ beacon: SAMPLE_BEACON, key });
    const tampered = packet.slice();
    tampered[3] = (tampered[3] ?? 0) ^ 0x02;
    await expectCode(openBeacon({ packet: tampered, key }), 'authentication_failed');
    await expectCode(
      openBeacon({ packet: packet.subarray(0, packet.length - 1), key }),
      'invalid_length',
    );
  });

  it('a null transition and no grants round-trip', async () => {
    const beacon: Beacon = {
      ...SAMPLE_BEACON,
      sessionOpen: false,
      ledMode: 'normal',
      sessionTransitionGnssS: null,
      grants: [],
    };
    expect(await openBeacon({ packet: await sealBeacon({ beacon, key }), key })).toEqual(beacon);
  });
});

describe('RTCM fragment', () => {
  const fragment = {
    networkId: 0x0a51,
    gnssTimeS: SAMPLE_BEACON.gnssTimeS,
    keyId: 2,
    fragmentIndex: 1,
    fragmentCount: 3,
    data: new Uint8Array(200).map((_, i) => i),
  };

  it('round-trips and never shares a nonce with the beacon or another fragment', async () => {
    const packet = await sealRtcmFragment({ fragment, key });
    expect(packet).toHaveLength(10 + 200 + 4);
    expect(await openRtcmFragment({ packet, key })).toEqual(fragment);
    const nonces = new Set(
      [
        { typeByte: 0x18, fragmentIndex: 0 },
        { typeByte: 0x1a, fragmentIndex: 0 },
        { typeByte: 0x1a, fragmentIndex: 1 },
        { typeByte: 0x19, fragmentIndex: 0 },
      ].map((part) => toHex(downlinkNonce({ networkId: 1, gnssTimeS: 2, ...part }))),
    );
    expect(nonces.size).toBe(4);
  });

  it('a full 255 B fragment is about 400 ms on air', async () => {
    const packet = await sealRtcmFragment({
      fragment: { ...fragment, data: new Uint8Array(MAX_RTCM_FRAGMENT_BODY_LENGTH) },
      key,
    });
    expect(packet).toHaveLength(255);
    expect(loraTimeOnAirMs(255)).toBeCloseTo(399.6, 1);
  });

  it('rejects bad indices, empty or oversized data, the wrong type and a swapped index', async () => {
    await expectCode(
      sealRtcmFragment({ fragment: { ...fragment, fragmentIndex: 3 }, key }),
      'field_out_of_range',
    );
    await expectCode(
      sealRtcmFragment({ fragment: { ...fragment, fragmentCount: 0, fragmentIndex: 0 }, key }),
      'field_out_of_range',
    );
    await expectCode(
      sealRtcmFragment({ fragment: { ...fragment, data: new Uint8Array(0) }, key }),
      'invalid_length',
    );
    await expectCode(
      sealRtcmFragment({ fragment: { ...fragment, data: new Uint8Array(242) }, key }),
      'invalid_length',
    );
    const packet = await sealRtcmFragment({ fragment, key });
    await expectCode(openBeacon({ packet, key }), 'unexpected_type');
    const swapped = packet.slice();
    swapped[8] = 0;
    await expectCode(openRtcmFragment({ packet: swapped, key }), 'authentication_failed');
    await expectCode(
      openRtcmFragment({ packet: await sealBeacon({ beacon: SAMPLE_BEACON, key }), key }),
      'unexpected_type',
    );
  });
});
