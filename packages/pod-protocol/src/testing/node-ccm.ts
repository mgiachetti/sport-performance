import { createCipheriv, createDecipheriv, type CipherCCMTypes } from 'node:crypto';

import type { CcmProvider } from '../crypto.js';

function algorithm(key: Uint8Array): CipherCCMTypes {
  return `aes-${String(key.length * 8)}-ccm` as CipherCCMTypes;
}

/**
 * Test-only provider over Node's OpenSSL `aes-*-ccm`, to cross-check the
 * pure-TypeScript provider. Not part of the build (Node-only).
 */
export const nodeCcmProvider: CcmProvider = {
  seal({ key, nonce, aad, plaintext, tagLength }) {
    const cipher = createCipheriv(algorithm(key), key, nonce, {
      authTagLength: tagLength,
    });
    cipher.setAAD(aad, { plaintextLength: plaintext.length });
    const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
    return Promise.resolve(new Uint8Array(Buffer.concat([ciphertext, cipher.getAuthTag()])));
  },
  open({ key, nonce, aad, sealed, tagLength }) {
    const ciphertext = sealed.subarray(0, sealed.length - tagLength);
    const decipher = createDecipheriv(algorithm(key), key, nonce, {
      authTagLength: tagLength,
    });
    decipher.setAuthTag(sealed.subarray(sealed.length - tagLength));
    decipher.setAAD(aad, { plaintextLength: ciphertext.length });
    const plaintext = decipher.update(ciphertext);
    try {
      decipher.final();
    } catch {
      return Promise.resolve(null);
    }
    return Promise.resolve(new Uint8Array(plaintext));
  },
};
