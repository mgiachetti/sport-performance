import { hkdfSync, randomBytes } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { fromHex, toHex } from './bytes.js';
import {
  deriveBeaconKey,
  deriveKey,
  deriveLinkKey,
  deriveStorageKey,
  kdfInfo,
  nobleCcmProvider,
} from './crypto.js';
import { PodProtocolError } from './errors.js';
import { nodeCcmProvider } from './testing/node-ccm.js';

describe('nobleCcmProvider', () => {
  it('matches RFC 3610 packet vector #1 (13 B nonce, 8 B AAD, 8 B tag)', async () => {
    const key = fromHex('c0c1c2c3c4c5c6c7c8c9cacbcccdcecf');
    const nonce = fromHex('00000003020100a0a1a2a3a4a5');
    const aad = fromHex('0001020304050607');
    const plaintext = fromHex('08090a0b0c0d0e0f101112131415161718191a1b1c1d1e');
    const sealed = await nobleCcmProvider.seal({ key, nonce, aad, plaintext, tagLength: 8 });
    expect(toHex(sealed)).toBe('588c979a61c663d2f066d0c2c0f989806d5f6b61dac38417e8d12cfdf926e0');
    expect(await nobleCcmProvider.open({ key, nonce, aad, sealed, tagLength: 8 })).toEqual(
      plaintext,
    );
  });

  it('agrees with Node/OpenSSL on random inputs, both ways', async () => {
    for (let i = 0; i < 200; i += 1) {
      const key = new Uint8Array(randomBytes(16));
      const nonce = new Uint8Array(randomBytes(13));
      const aad = new Uint8Array(randomBytes(i % 20));
      const plaintext = new Uint8Array(randomBytes(i % 70));
      const tagLength = [4, 8, 16][i % 3] ?? 4;
      const ours = await nobleCcmProvider.seal({ key, nonce, aad, plaintext, tagLength });
      const theirs = await nodeCcmProvider.seal({ key, nonce, aad, plaintext, tagLength });
      expect(toHex(ours)).toBe(toHex(theirs));
      expect(await nodeCcmProvider.open({ key, nonce, aad, sealed: ours, tagLength })).toEqual(
        plaintext,
      );
      expect(await nobleCcmProvider.open({ key, nonce, aad, sealed: theirs, tagLength })).toEqual(
        plaintext,
      );
    }
  });

  it('rejects a flipped bit in the ciphertext, the tag or the AAD', async () => {
    const key = new Uint8Array(16).fill(7);
    const nonce = new Uint8Array(13).fill(1);
    const aad = new Uint8Array([1, 2, 3]);
    const sealed = await nobleCcmProvider.seal({
      key,
      nonce,
      aad,
      plaintext: new Uint8Array([9, 9, 9]),
      tagLength: 4,
    });
    for (let i = 0; i < sealed.length; i += 1) {
      const tampered = sealed.slice();
      tampered[i] = (tampered[i] ?? 0) ^ 0x01;
      expect(
        await nobleCcmProvider.open({ key, nonce, aad, sealed: tampered, tagLength: 4 }),
      ).toBeNull();
    }
    expect(
      await nobleCcmProvider.open({
        key,
        nonce,
        aad: new Uint8Array([1, 2, 4]),
        sealed,
        tagLength: 4,
      }),
    ).toBeNull();
  });
});

describe('key derivation', () => {
  const masterKey = fromHex('000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f');
  const deviceId = fromHex('0123456789abcdef');

  it('is HKDF-SHA256 with an empty salt and the documented info', () => {
    const info = kdfInfo('uplink', deviceId, 3);
    expect(toHex(info)).toBe(
      `${Buffer.from('sport-performance/pod-kdf/v1/uplink').toString('hex')}0008${toHex(deviceId)}03`,
    );
    const expected = new Uint8Array(hkdfSync('sha256', masterKey, new Uint8Array(0), info, 16));
    expect(deriveLinkKey({ masterKey, deviceId, epoch: 3 })).toEqual(expected);
  });

  it('separates labels, devices and epochs', () => {
    const keys = [
      deriveLinkKey({ masterKey, deviceId, epoch: 0 }),
      deriveLinkKey({ masterKey, deviceId, epoch: 1 }),
      deriveStorageKey({ masterKey, deviceId, epoch: 0 }),
      deriveBeaconKey({ masterKey, gatewayId: deviceId, epoch: 0 }),
      deriveLinkKey({ masterKey, deviceId: fromHex('0123456789abcdee'), epoch: 0 }),
    ].map(toHex);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('rejects a short master key, a wrong id length and an epoch out of range', () => {
    expect(() => deriveLinkKey({ masterKey: new Uint8Array(16), deviceId, epoch: 0 })).toThrow(
      PodProtocolError,
    );
    expect(() => deriveLinkKey({ masterKey, deviceId: new Uint8Array(4), epoch: 0 })).toThrow(
      PodProtocolError,
    );
    expect(() => deriveKey({ masterKey, label: 'beacon', id: deviceId, epoch: 256 })).toThrow(
      PodProtocolError,
    );
  });
});
