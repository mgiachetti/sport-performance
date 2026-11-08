import { createCipheriv } from 'node:crypto';
import { crc32 as zlibCrc32 } from 'node:zlib';

import { describe, expect, it } from 'vitest';

import { fromHex, toHex } from '../bytes.js';
import { crc32, logPageCtr, logPageIv, logPageMac } from './integrity.js';

describe('crc32', () => {
  it('matches zlib (IEEE 802.3) and the check value', () => {
    expect(crc32(new TextEncoder().encode('123456789'))).toBe(0xcbf43926);
    const data = Uint8Array.from({ length: 2044 }, (_, i) => (i * 31) & 0xff);
    expect(crc32(data)).toBe(zlibCrc32(data));
    expect(crc32(new Uint8Array(0))).toBe(0);
  });
});

describe('page IV', () => {
  it('is key epoch ‖ page sequence LE ‖ zeros, never the physical address', () => {
    expect(toHex(logPageIv(2, 0x0102_0304))).toBe('0204030201000000' + '0000000000000000');
    expect(() => logPageIv(256, 0)).toThrow();
  });
});

describe('AES-CTR', () => {
  it('matches OpenSSL aes-128-ctr with the page IV', () => {
    const key = fromHex('2b7e151628aed2a6abf7158809cf4f3c');
    const data = Uint8Array.from({ length: 1996 }, (_, i) => i & 0xff);
    const cipher = createCipheriv('aes-128-ctr', key, logPageIv(7, 123_456));
    const expected = new Uint8Array(Buffer.concat([cipher.update(data), cipher.final()]));
    const ours = logPageCtr(key, 7, 123_456, data);
    expect(toHex(ours)).toBe(toHex(expected));
    expect(toHex(logPageCtr(key, 7, 123_456, ours))).toBe(toHex(data));
  });
});

describe('AES-CMAC (RFC 4493)', () => {
  const key = fromHex('2b7e151628aed2a6abf7158809cf4f3c');
  const message = fromHex(
    '6bc1bee22e409f96e93d7e117393172aae2d8a571e03ac9c9eb76fac45af8e5130c81c46a35ce411e5fbc1191a0a52eff69f2445df4f9b17ad2b417be66c3710',
  );
  it.each([
    [0, 'bb1d6929e95937287fa37d129b756746'],
    [16, '070a16b46b4d4144f79bdd9dd04a287c'],
    [40, 'dfa66747de9ae63030ca32611497c827'],
    [64, '51f0bebf7e3b9d92fc49741779363cfe'],
  ])('example with %i B, truncated to 8 B', (length, tag) => {
    expect(toHex(logPageMac(key, message.slice(0, length)))).toBe(tag.slice(0, 16));
  });
  it('rejects a key that is not AES-128', () => {
    expect(() => logPageMac(new Uint8Array(32), message)).toThrow();
  });
});
