import { cmac, ctr } from '@noble/ciphers/aes.js';

import { hkdf } from '@noble/hashes/hkdf.js';
import { sha256 } from '@noble/hashes/sha2.js';

import { asciiBytes, assertUint } from '../bytes.js';
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

/** Byte 0 of every CTR counter block of a log page: no counter block is ever all zeros. */
export const LOG_PAGE_IV_DOMAIN = 0x4c;

/**
 * Initial counter block of the AES-CTR of a page (ADR 0106: "época de clave +
 * número de secuencia de la página", never the physical address):
 *
 * ```
 * 0      domain 0x4C ("L"): a counter block is never all zeros
 * 1      key epoch (u8)
 * 2..5   page sequence (u32 LE)
 * 6..11  0x00
 * 12..15 block counter (u32 BE, starts at 0; a page is 125 blocks)
 * ```
 */
export function logPageIv(keyEpoch: number, pageSeq: number): Uint8Array {
  assertUint('keyEpoch', keyEpoch, 8);
  assertUint('pageSeq', pageSeq, 32);
  const iv = new Uint8Array(16);
  iv[0] = LOG_PAGE_IV_DOMAIN;
  iv[1] = keyEpoch;
  iv[2] = pageSeq & 0xff;
  iv[3] = (pageSeq >>> 8) & 0xff;
  iv[4] = (pageSeq >>> 16) & 0xff;
  iv[5] = (pageSeq >>> 24) & 0xff;
  return iv;
}

/** The two keys of the log pages, derived from the storage key of an epoch. */
export interface LogPageKeys {
  /** AES-128-CTR of the payload. */
  encKey: Uint8Array;
  /** AES-CMAC of header ‖ ciphertext. */
  macKey: Uint8Array;
}

const LOG_KEY_INFO_PREFIX = 'sport-performance/pod-log/v1/';

/**
 * Separate encryption and MAC keys (key separation: CTR and CMAC never share
 * a key): HKDF-SHA256 (RFC 5869) with the storage key as input, empty salt and
 * `info` = ASCII("sport-performance/pod-log/v1/ctr") or ".../cmac", 16 B each.
 * The pod derives them once per epoch.
 */
export function deriveLogPageKeys(storageKey: Uint8Array): LogPageKeys {
  checkStorageKey(storageKey);
  return {
    encKey: hkdf(sha256, storageKey, undefined, asciiBytes(`${LOG_KEY_INFO_PREFIX}ctr`), 16),
    macKey: hkdf(sha256, storageKey, undefined, asciiBytes(`${LOG_KEY_INFO_PREFIX}cmac`), 16),
  };
}

export function checkStorageKey(key: Uint8Array): void {
  if (key.length !== AES_KEY_LENGTH) {
    fail('invalid_key', `the storage key is AES-128 (${String(AES_KEY_LENGTH)} B)`);
  }
}

/** AES-128-CTR of a page payload with the `encKey` (encrypt and decrypt are the same operation). */
export function logPageCtr(
  key: Uint8Array,
  keyEpoch: number,
  pageSeq: number,
  data: Uint8Array,
): Uint8Array {
  checkStorageKey(key);
  return ctr(key, logPageIv(keyEpoch, pageSeq)).encrypt(data);
}

/** AES-CMAC (RFC 4493) with the `macKey`, truncated to its first 8 B (ADR 0106). */
export function logPageMac(key: Uint8Array, message: Uint8Array): Uint8Array {
  checkStorageKey(key);
  return cmac(message, key).slice(0, LOG_PAGE_MAC_LENGTH);
}
