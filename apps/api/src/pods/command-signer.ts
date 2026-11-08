import { createPrivateKey, sign, type KeyObject } from 'node:crypto';

/**
 * Signer of the commands the server sends to a pod through the dock (ADR
 * 0106, 0108): the pod has the server's P-256 public key from the factory and
 * verifies every command (erase, and later provision, rotate, update). The
 * dock only passes opaque blobs. The key comes from the environment
 * (`POD_COMMAND_SIGNING_KEY`, a PKCS#8 P-256 private key in base64); tests
 * inject one generated at run time. A real key is never committed.
 *
 * Signatures are **low-S** (`s ≤ n/2`, as Bitcoin and many embedded
 * verifiers require): a verifier that rejects high-S signatures accepts every
 * one of these, and one that accepts both is unaffected.
 */
export interface PodCommandSigner {
  /** Id of the key the pod uses to pick the public key (rotation). */
  readonly keyId: string;
  readonly algorithm: 'ecdsa-p256-sha256';
  /** ECDSA P-256 over SHA-256 of `message`, as `r ‖ s` (64 B, IEEE P1363), low-S. */
  sign(message: Uint8Array): Uint8Array;
}

/** `r ‖ s`, the fixed-size form a microcontroller verifies without parsing DER. */
export const POD_COMMAND_SIGNATURE_LENGTH = 64;

export const POD_COMMAND_KEY_ID_PATTERN = /^[A-Za-z0-9._-]{1,64}$/;

/** Order of the P-256 group. */
export const P256_ORDER = BigInt(
  '0xffffffff00000000ffffffffffffffffbce6faada7179e84f3b9cac2fc632551',
);
const HALF_ORDER = P256_ORDER >> 1n;

/** Base64 without the whitespace a copy and paste or `base64` line wrapping leaves. */
export function compactBase64(value: string): string {
  return value.replace(/\s+/g, '');
}

function p256KeyOf(pkcs8Base64: string): KeyObject {
  const key = createPrivateKey({
    key: Buffer.from(compactBase64(pkcs8Base64), 'base64'),
    format: 'der',
    type: 'pkcs8',
  });
  if (key.asymmetricKeyType !== 'ec' || key.asymmetricKeyDetails?.namedCurve !== 'prime256v1') {
    throw new Error('not a P-256 key');
  }
  return key;
}

/** Why a configured key cannot sign (never the key itself); `null` when it can. */
export function podCommandKeyProblem(pkcs8Base64: string): string | null {
  try {
    p256KeyOf(pkcs8Base64);
    return null;
  } catch {
    return 'must be a P-256 private key, PKCS#8 DER in base64';
  }
}

function toBigInt(bytes: Uint8Array): bigint {
  return BigInt(`0x${Buffer.from(bytes).toString('hex') || '0'}`);
}

function to32Bytes(value: bigint): Uint8Array {
  return new Uint8Array(Buffer.from(value.toString(16).padStart(64, '0'), 'hex'));
}

/** `r ‖ s` with `s` replaced by `n − s` when it is in the upper half (the same signature). */
export function lowS(signature: Uint8Array): Uint8Array {
  const s = toBigInt(signature.subarray(32, 64));
  if (s <= HALF_ORDER) return signature;
  const out = new Uint8Array(64);
  out.set(signature.subarray(0, 32), 0);
  out.set(to32Bytes(P256_ORDER - s), 32);
  return out;
}

export function createPodCommandSigner(options: {
  readonly privateKeyPkcs8Base64: string;
  readonly keyId: string;
}): PodCommandSigner {
  if (!POD_COMMAND_KEY_ID_PATTERN.test(options.keyId)) {
    throw new Error('Invalid pod command key id');
  }
  const key = p256KeyOf(options.privateKeyPkcs8Base64);
  return {
    keyId: options.keyId,
    algorithm: 'ecdsa-p256-sha256',
    sign: (message) =>
      lowS(new Uint8Array(sign('sha256', message, { key, dsaEncoding: 'ieee-p1363' }))),
  };
}
