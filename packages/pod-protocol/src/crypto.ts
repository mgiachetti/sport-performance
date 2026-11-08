import { cbc, ctr, ecb } from '@noble/ciphers/aes.js';
import { hkdf } from '@noble/hashes/hkdf.js';
import { sha256 } from '@noble/hashes/sha2.js';

import { asciiBytes, assertUint, concatBytes, equalBytes } from './bytes.js';
import { AES_KEY_LENGTH } from './constants.js';
import { fail } from './errors.js';

export interface CcmSealInput {
  key: Uint8Array;
  nonce: Uint8Array;
  aad: Uint8Array;
  plaintext: Uint8Array;
  tagLength: number;
}

export interface CcmOpenInput {
  key: Uint8Array;
  nonce: Uint8Array;
  aad: Uint8Array;
  /** Ciphertext followed by the tag (MIC). */
  sealed: Uint8Array;
  tagLength: number;
}

/**
 * AES-CCM (RFC 3610 / NIST SP 800-38C) behind an injectable interface, so the
 * mobile app can swap in a native module, the worker can use Node's `crypto`,
 * and the tests cross-check one against the other. Async on purpose: native
 * and WebCrypto-style providers are.
 */
export interface CcmProvider {
  /** Returns ciphertext ‖ tag. */
  seal(input: CcmSealInput): Promise<Uint8Array>;
  /** Returns the plaintext, or `null` if the tag does not verify. */
  open(input: CcmOpenInput): Promise<Uint8Array | null>;
}

const BLOCK = 16;

function checkCcmParams(key: Uint8Array, nonce: Uint8Array, tagLength: number): void {
  if (key.length !== 16 && key.length !== 24 && key.length !== 32) {
    fail('invalid_key', 'AES key must be 16, 24 or 32 B');
  }
  if (nonce.length < 7 || nonce.length > 13) {
    fail('invalid_length', 'CCM nonce must be 7..13 B');
  }
  if (tagLength < 4 || tagLength > 16 || tagLength % 2 !== 0) {
    fail('invalid_length', 'CCM tag must be 4, 6, …, 16 B');
  }
}

function lengthField(nonceLength: number): number {
  return 15 - nonceLength;
}

function writeBigEndian(target: Uint8Array, value: number, offset: number, length: number): void {
  let rest = value;
  for (let i = length - 1; i >= 0; i -= 1) {
    target[offset + i] = rest & 0xff;
    rest = Math.floor(rest / 256);
  }
}

function counterBlock(nonce: Uint8Array, index: number): Uint8Array {
  const l = lengthField(nonce.length);
  const block = new Uint8Array(BLOCK);
  block[0] = l - 1;
  block.set(nonce, 1);
  writeBigEndian(block, index, 1 + nonce.length, l);
  return block;
}

function padToBlock(bytes: Uint8Array): Uint8Array {
  const padded = new Uint8Array(Math.ceil(bytes.length / BLOCK) * BLOCK);
  padded.set(bytes);
  return padded;
}

/** CBC-MAC over B0 ‖ encoded AAD ‖ padded message (SP 800-38C A.2). */
function cbcMac(
  key: Uint8Array,
  nonce: Uint8Array,
  aad: Uint8Array,
  message: Uint8Array,
  tagLength: number,
): Uint8Array {
  const l = lengthField(nonce.length);
  if (message.length >= 2 ** (8 * l)) {
    fail('invalid_length', 'message too long for the CCM length field');
  }
  if (aad.length >= 0xff00) {
    fail('invalid_length', 'AAD too long for this CCM implementation');
  }
  const b0 = new Uint8Array(BLOCK);
  b0[0] = (aad.length > 0 ? 0x40 : 0) | (((tagLength - 2) / 2) << 3) | (l - 1);
  b0.set(nonce, 1);
  writeBigEndian(b0, message.length, 1 + nonce.length, l);
  const aadBlocks =
    aad.length > 0
      ? padToBlock(concatBytes(new Uint8Array([aad.length >>> 8, aad.length & 0xff]), aad))
      : new Uint8Array(0);
  const input = concatBytes(b0, aadBlocks, padToBlock(message));
  const macChain = cbc(key, new Uint8Array(BLOCK), { disablePadding: true }).encrypt(input);
  return macChain.slice(macChain.length - BLOCK, macChain.length - BLOCK + tagLength);
}

function ctrCrypt(key: Uint8Array, nonce: Uint8Array, data: Uint8Array): Uint8Array {
  if (data.length === 0) {
    return new Uint8Array(0);
  }
  return ctr(key, counterBlock(nonce, 1)).encrypt(data);
}

function tagMask(key: Uint8Array, nonce: Uint8Array, tagLength: number): Uint8Array {
  return ecb(key, { disablePadding: true }).encrypt(counterBlock(nonce, 0)).slice(0, tagLength);
}

function xor(a: Uint8Array, b: Uint8Array): Uint8Array {
  const out = new Uint8Array(a.length);
  for (let i = 0; i < a.length; i += 1) {
    out[i] = (a[i] ?? 0) ^ (b[i] ?? 0);
  }
  return out;
}

/**
 * CCM built on the audited AES primitives of `@noble/ciphers` (ECB, CBC and CTR
 * of a single block cipher; noble ships no CCM mode). Pure TypeScript: runs in
 * the worker, the API and React Native. Checked against Node's `aes-*-ccm` and
 * RFC 3610 in the tests.
 */
export const nobleCcmProvider: CcmProvider = {
  seal({ key, nonce, aad, plaintext, tagLength }) {
    checkCcmParams(key, nonce, tagLength);
    const tag = cbcMac(key, nonce, aad, plaintext, tagLength);
    const ciphertext = ctrCrypt(key, nonce, plaintext);
    return Promise.resolve(concatBytes(ciphertext, xor(tag, tagMask(key, nonce, tagLength))));
  },
  open({ key, nonce, aad, sealed, tagLength }) {
    checkCcmParams(key, nonce, tagLength);
    if (sealed.length < tagLength) {
      return Promise.resolve(null);
    }
    const ciphertext = sealed.slice(0, sealed.length - tagLength);
    const receivedTag = sealed.slice(sealed.length - tagLength);
    const plaintext = ctrCrypt(key, nonce, ciphertext);
    const expectedTag = xor(
      cbcMac(key, nonce, aad, plaintext, tagLength),
      tagMask(key, nonce, tagLength),
    );
    return Promise.resolve(equalBytes(expectedTag, receivedTag) ? plaintext : null);
  },
};

// ---------------------------------------------------------------------------
// Key derivation
// ---------------------------------------------------------------------------

/** Club master key: 32 random bytes, only on the server (ADR 0106). */
export const MASTER_KEY_LENGTH = 32;
/** FICR `DEVICEID[0]` ‖ `DEVICEID[1]` as they sit in memory (0x10000060..0x10000067). */
export const DEVICE_ID_LENGTH = 8;
/** EUI-64 of the gateway concentrator. */
export const GATEWAY_ID_LENGTH = 8;

export const KDF_LABELS = ['uplink', 'storage', 'beacon'] as const;
export type KdfLabel = (typeof KDF_LABELS)[number];

const KDF_INFO_PREFIX = 'sport-performance/pod-kdf/v1/';

/**
 * `info` of the HKDF (the ADR writes it as `label | id | época`):
 *
 * ```
 * ASCII("sport-performance/pod-kdf/v1/" + label) ‖ 0x00 ‖ u8(len(id)) ‖ id ‖ u8(epoch)
 * ```
 */
export function kdfInfo(label: KdfLabel, id: Uint8Array, epoch: number): Uint8Array {
  assertUint('epoch', epoch, 8);
  if (id.length === 0 || id.length > 0xff) {
    fail('field_out_of_range', 'KDF id must be 1..255 B');
  }
  return concatBytes(
    asciiBytes(KDF_INFO_PREFIX + label),
    new Uint8Array([0x00, id.length]),
    id,
    new Uint8Array([epoch]),
  );
}

/**
 * `KDF(maestra, label | id | época)` = HKDF-SHA256 (RFC 5869) with an empty
 * salt and the `info` above, 16 B out (AES-128: the CryptoCell-310 of the
 * nRF52840 only does 128-bit AES keys).
 */
export function deriveKey(input: {
  masterKey: Uint8Array;
  label: KdfLabel;
  id: Uint8Array;
  epoch: number;
}): Uint8Array {
  if (input.masterKey.length !== MASTER_KEY_LENGTH) {
    fail('invalid_key', `club master key must be ${String(MASTER_KEY_LENGTH)} B`);
  }
  return hkdf(
    sha256,
    input.masterKey,
    undefined,
    kdfInfo(input.label, input.id, input.epoch),
    AES_KEY_LENGTH,
  );
}

function checkFixedId(name: string, id: Uint8Array, length: number): void {
  if (id.length !== length) {
    fail('field_out_of_range', `${name} must be ${String(length)} B`);
  }
}

/** Link key of a pod: `KDF(maestra, "uplink" | DEVICEID | época)`. */
export function deriveLinkKey(input: {
  masterKey: Uint8Array;
  deviceId: Uint8Array;
  epoch: number;
}): Uint8Array {
  checkFixedId('deviceId', input.deviceId, DEVICE_ID_LENGTH);
  return deriveKey({
    masterKey: input.masterKey,
    label: 'uplink',
    id: input.deviceId,
    epoch: input.epoch,
  });
}

/** NAND storage key of a pod: `KDF(maestra, "storage" | DEVICEID | época)`. */
export function deriveStorageKey(input: {
  masterKey: Uint8Array;
  deviceId: Uint8Array;
  epoch: number;
}): Uint8Array {
  checkFixedId('deviceId', input.deviceId, DEVICE_ID_LENGTH);
  return deriveKey({
    masterKey: input.masterKey,
    label: 'storage',
    id: input.deviceId,
    epoch: input.epoch,
  });
}

/** Beacon key of a gateway: `KDF(maestra, "beacon" | id del gateway | época)`. */
export function deriveBeaconKey(input: {
  masterKey: Uint8Array;
  gatewayId: Uint8Array;
  epoch: number;
}): Uint8Array {
  checkFixedId('gatewayId', input.gatewayId, GATEWAY_ID_LENGTH);
  return deriveKey({
    masterKey: input.masterKey,
    label: 'beacon',
    id: input.gatewayId,
    epoch: input.epoch,
  });
}

export function checkAesKey(key: Uint8Array): void {
  if (key.length !== AES_KEY_LENGTH) {
    fail('invalid_key', `link and beacon keys are AES-128 (${String(AES_KEY_LENGTH)} B)`);
  }
}
