import { generateKeyPairSync, verify } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  POD_COMMAND_SIGNATURE_LENGTH,
  createPodCommandSigner,
  podCommandKeyProblem,
} from './command-signer.js';

/** A key generated for this run only: no key is ever committed. */
function testKey() {
  const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  return {
    pkcs8Base64: privateKey.export({ format: 'der', type: 'pkcs8' }).toString('base64'),
    publicKey,
  };
}

describe('pod command signer', () => {
  it('signs with P-256 as r ‖ s, verifiable with the public key', () => {
    const { pkcs8Base64, publicKey } = testKey();
    const signer = createPodCommandSigner({ privateKeyPkcs8Base64: pkcs8Base64, keyId: 'test-1' });
    const message = new TextEncoder().encode('SPER command');
    const signature = signer.sign(message);
    expect(signature).toHaveLength(POD_COMMAND_SIGNATURE_LENGTH);
    expect(signer).toMatchObject({ keyId: 'test-1', algorithm: 'ecdsa-p256-sha256' });
    expect(
      verify('sha256', message, { key: publicKey, dsaEncoding: 'ieee-p1363' }, signature),
    ).toBe(true);
    const other = new TextEncoder().encode('SPER commanc');
    expect(verify('sha256', other, { key: publicKey, dsaEncoding: 'ieee-p1363' }, signature)).toBe(
      false,
    );
  });

  it('refuses anything but a P-256 key and a bad key id, without echoing the key', () => {
    expect(podCommandKeyProblem(testKey().pkcs8Base64)).toBeNull();
    const rsa = generateKeyPairSync('rsa', { modulusLength: 2048 })
      .privateKey.export({ format: 'der', type: 'pkcs8' })
      .toString('base64');
    expect(podCommandKeyProblem(rsa)).toMatch(/P-256/);
    const p384 = generateKeyPairSync('ec', { namedCurve: 'secp384r1' })
      .privateKey.export({ format: 'der', type: 'pkcs8' })
      .toString('base64');
    expect(podCommandKeyProblem(p384)).toMatch(/P-256/);
    expect(podCommandKeyProblem('bm90IGEga2V5')).toMatch(/P-256/);
    expect(() =>
      createPodCommandSigner({ privateKeyPkcs8Base64: testKey().pkcs8Base64, keyId: 'bad id' }),
    ).toThrow('key id');
  });
});
