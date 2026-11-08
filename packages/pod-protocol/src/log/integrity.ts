import { cmac, ctr } from '@noble/ciphers/aes.js';

import { assertUint } from '../bytes.js';
import { AES_KEY_LENGTH } from '../constants.js';
import { fail } from '../errors.js';
import { LOG_PAGE_MAC_LENGTH } from './constants.js';

/**
 * CRC-32 (IEEE 802.3, reflected, polynomial 0xEDB88320, init and final XOR
 * 0xFFFFFFFF): the same as zlib, Ethernet and Zephyr's `crc32_ieee`.
 */
const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  return table;
})();

export function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc = (CRC_TABLE[(crc ^ byte) & 0xff] ?? 0) ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

/**
 * Initial counter block of the AES-CTR of a page (ADR 0106: "época de clave +
 * número de secuencia de la página", never the physical address):
 *
 * ```
 * 0      key epoch (u8)
 * 1..4   page sequence (u32 LE)
 * 5..11  0x00
 * 12..15 block counter (u32 BE, starts at 0; a page is 125 blocks)
 * ```
 *
 * Counter blocks never collide with the first CMAC block of a page: that one
 * starts with the magic "SPLG" and carries the epoch in byte 5, so a collision
 * would need epoch = 0x53 and epoch = 0 at once.
 */
export function logPageIv(keyEpoch: number, pageSeq: number): Uint8Array {
  assertUint('keyEpoch', keyEpoch, 8);
  assertUint('pageSeq', pageSeq, 32);
  const iv = new Uint8Array(16);
  iv[0] = keyEpoch;
  iv[1] = pageSeq & 0xff;
  iv[2] = (pageSeq >>> 8) & 0xff;
  iv[3] = (pageSeq >>> 16) & 0xff;
  iv[4] = (pageSeq >>> 24) & 0xff;
  return iv;
}

export function checkStorageKey(key: Uint8Array): void {
  if (key.length !== AES_KEY_LENGTH) {
    fail('invalid_key', `the storage key is AES-128 (${String(AES_KEY_LENGTH)} B)`);
  }
}

/** AES-128-CTR of a page payload (encrypt and decrypt are the same operation). */
export function logPageCtr(
  key: Uint8Array,
  keyEpoch: number,
  pageSeq: number,
  data: Uint8Array,
): Uint8Array {
  checkStorageKey(key);
  return ctr(key, logPageIv(keyEpoch, pageSeq)).encrypt(data);
}

/** AES-CMAC (RFC 4493) truncated to its first 8 B (ADR 0106). */
export function logPageMac(key: Uint8Array, message: Uint8Array): Uint8Array {
  checkStorageKey(key);
  return cmac(message, key).slice(0, LOG_PAGE_MAC_LENGTH);
}
