/*
 * Crypto primitives the pod formats need (ADR 0106), behind one interface with
 * two backends:
 *
 * - `crypto_psa.c` (target): PSA Crypto from nrf_security, on the CryptoCell-310
 *   of the nRF52840 (AES-128 only, which is why every key is 16 B).
 * - `crypto_soft.c` (host tests, never linked into a release image): a small
 *   reference implementation of AES-128, SHA-256 and the modes on top, checked
 *   against FIPS-197, RFC 4493, RFC 5869 and RFC 3610 in tests/host.
 *
 * The format code (uplink, beacon, log page) only calls these functions, so the
 * host tests prove the byte layout and the target build proves the PSA calls
 * compile; the PSA path itself is exercised by the boot self-test
 * (crypto_selftest.c) against the same vectors the host tests run.
 */
#ifndef POD_CRYPTO_H_
#define POD_CRYPTO_H_

#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>

#define POD_AES_KEY_LEN 16
#define POD_AES_BLOCK_LEN 16
#define POD_CCM_NONCE_LEN 13

/**
 * True for an all-zero key: what the pod holds before the dock provisions it
 * (ADR 0106). Nothing is sealed with such a key (`POD_ERR_STATE`).
 */
static inline bool pod_key_is_zero(const uint8_t *key, size_t len)
{
	uint8_t acc = 0;

	for (size_t i = 0; i < len; i++) {
		acc |= key[i];
	}
	return acc == 0;
}

/** Must be called once before any other function (PSA: `psa_crypto_init`). */
int pod_crypto_init(void);

/** AES-128-CTR; the whole 16 B block is the big-endian counter (SP 800-38A). */
int pod_aes128_ctr(const uint8_t key[POD_AES_KEY_LEN], const uint8_t iv[POD_AES_BLOCK_LEN],
		   const uint8_t *in, uint8_t *out, size_t len);

/** AES-CMAC (RFC 4493), full 16 B tag. */
int pod_aes128_cmac(const uint8_t key[POD_AES_KEY_LEN], const uint8_t *msg, size_t len,
		    uint8_t mac[POD_AES_BLOCK_LEN]);

/**
 * AES-128-CCM (RFC 3610 / SP 800-38C) with a 13 B nonce (L = 2).
 * `out` receives ciphertext ‖ tag (`pt_len + tag_len` bytes). `out` may alias `pt`.
 */
int pod_aes128_ccm_seal(const uint8_t key[POD_AES_KEY_LEN], const uint8_t nonce[POD_CCM_NONCE_LEN],
			const uint8_t *aad, size_t aad_len, const uint8_t *pt, size_t pt_len,
			uint8_t *out, size_t tag_len);

/**
 * Opens ciphertext ‖ tag. Returns `POD_ERR_AUTH` (and zeroes `out`) when the tag
 * does not verify.
 */
int pod_aes128_ccm_open(const uint8_t key[POD_AES_KEY_LEN], const uint8_t nonce[POD_CCM_NONCE_LEN],
			const uint8_t *aad, size_t aad_len, const uint8_t *sealed, size_t sealed_len,
			uint8_t *out, size_t tag_len);

/** HKDF-SHA256 (RFC 5869) with an empty salt, as the pod KDF uses. */
int pod_hkdf_sha256(const uint8_t *ikm, size_t ikm_len, const uint8_t *info, size_t info_len,
		    uint8_t *out, size_t out_len);

/** Constant-time comparison: 0 when equal. */
int pod_ct_compare(const uint8_t *a, const uint8_t *b, size_t len);

#endif /* POD_CRYPTO_H_ */
