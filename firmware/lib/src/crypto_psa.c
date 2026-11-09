/*
 * Target backend of pod/crypto.h on PSA Crypto (nrf_security: CryptoCell-310
 * of the nRF52840, Oberon as fallback). Keys are imported as volatile keys per
 * operation and destroyed right after.
 *
 * TODO(B-904): keep the link, beacon and storage keys of the current epoch as
 * persistent PSA keys (internal trusted storage) once the dock provisioning
 * (keys wrapped with the device key, ADR 0106) exists, instead of plain buffers.
 */
#include <string.h>

#include <psa/crypto.h>

#include "pod/crypto.h"
#include "pod/errors.h"

int pod_crypto_init(void)
{
	return psa_crypto_init() == PSA_SUCCESS ? POD_OK : POD_ERR_CRYPTO;
}

static int import_aes(const uint8_t key[POD_AES_KEY_LEN], psa_algorithm_t alg,
		      psa_key_usage_t usage, psa_key_id_t *id)
{
	psa_key_attributes_t attr = PSA_KEY_ATTRIBUTES_INIT;

	psa_set_key_type(&attr, PSA_KEY_TYPE_AES);
	psa_set_key_bits(&attr, 128);
	psa_set_key_algorithm(&attr, alg);
	psa_set_key_usage_flags(&attr, usage);
	psa_set_key_lifetime(&attr, PSA_KEY_LIFETIME_VOLATILE);
	return psa_import_key(&attr, key, POD_AES_KEY_LEN, id) == PSA_SUCCESS ? POD_OK
									     : POD_ERR_CRYPTO;
}

int pod_aes128_ctr(const uint8_t key[POD_AES_KEY_LEN], const uint8_t iv[POD_AES_BLOCK_LEN],
		   const uint8_t *in, uint8_t *out, size_t len)
{
	psa_cipher_operation_t op = PSA_CIPHER_OPERATION_INIT;
	psa_key_id_t id;
	size_t n = 0, tail = 0;
	psa_status_t st;

	if (import_aes(key, PSA_ALG_CTR, PSA_KEY_USAGE_ENCRYPT, &id) != POD_OK) {
		return POD_ERR_CRYPTO;
	}
	/* Multi-part so the IV is ours (psa_cipher_encrypt would pick a random one). */
	st = psa_cipher_encrypt_setup(&op, id, PSA_ALG_CTR);
	if (st == PSA_SUCCESS) {
		st = psa_cipher_set_iv(&op, iv, POD_AES_BLOCK_LEN);
	}
	if (st == PSA_SUCCESS) {
		st = psa_cipher_update(&op, in, len, out, len, &n);
	}
	if (st == PSA_SUCCESS) {
		st = psa_cipher_finish(&op, &out[n], len - n, &tail);
	}
	if (st != PSA_SUCCESS) {
		psa_cipher_abort(&op);
	}
	psa_destroy_key(id);
	return st == PSA_SUCCESS && n + tail == len ? POD_OK : POD_ERR_CRYPTO;
}

int pod_aes128_cmac(const uint8_t key[POD_AES_KEY_LEN], const uint8_t *msg, size_t len,
		    uint8_t mac[POD_AES_BLOCK_LEN])
{
	psa_key_id_t id;
	size_t n = 0;
	psa_status_t st;

	if (import_aes(key, PSA_ALG_CMAC, PSA_KEY_USAGE_SIGN_MESSAGE, &id) != POD_OK) {
		return POD_ERR_CRYPTO;
	}
	st = psa_mac_compute(id, PSA_ALG_CMAC, msg, len, mac, POD_AES_BLOCK_LEN, &n);
	psa_destroy_key(id);
	return st == PSA_SUCCESS && n == POD_AES_BLOCK_LEN ? POD_OK : POD_ERR_CRYPTO;
}

int pod_aes128_ccm_seal(const uint8_t key[POD_AES_KEY_LEN], const uint8_t nonce[POD_CCM_NONCE_LEN],
			const uint8_t *aad, size_t aad_len, const uint8_t *pt, size_t pt_len,
			uint8_t *out, size_t tag_len)
{
	psa_algorithm_t alg = PSA_ALG_AEAD_WITH_SHORTENED_TAG(PSA_ALG_CCM, tag_len);
	psa_key_id_t id;
	size_t n = 0;
	psa_status_t st;

	if (import_aes(key, alg, PSA_KEY_USAGE_ENCRYPT, &id) != POD_OK) {
		return POD_ERR_CRYPTO;
	}
	st = psa_aead_encrypt(id, alg, nonce, POD_CCM_NONCE_LEN, aad, aad_len, pt, pt_len, out,
			      pt_len + tag_len, &n);
	psa_destroy_key(id);
	return st == PSA_SUCCESS && n == pt_len + tag_len ? POD_OK : POD_ERR_CRYPTO;
}

int pod_aes128_ccm_open(const uint8_t key[POD_AES_KEY_LEN], const uint8_t nonce[POD_CCM_NONCE_LEN],
			const uint8_t *aad, size_t aad_len, const uint8_t *sealed, size_t sealed_len,
			uint8_t *out, size_t tag_len)
{
	psa_algorithm_t alg = PSA_ALG_AEAD_WITH_SHORTENED_TAG(PSA_ALG_CCM, tag_len);
	psa_key_id_t id;
	size_t n = 0;
	psa_status_t st;

	if (sealed_len < tag_len) {
		return POD_ERR_LENGTH;
	}
	if (import_aes(key, alg, PSA_KEY_USAGE_DECRYPT, &id) != POD_OK) {
		return POD_ERR_CRYPTO;
	}
	st = psa_aead_decrypt(id, alg, nonce, POD_CCM_NONCE_LEN, aad, aad_len, sealed, sealed_len,
			      out, sealed_len - tag_len, &n);
	psa_destroy_key(id);
	if (st == PSA_ERROR_INVALID_SIGNATURE) {
		memset(out, 0, sealed_len - tag_len);
		return POD_ERR_AUTH;
	}
	return st == PSA_SUCCESS ? POD_OK : POD_ERR_CRYPTO;
}

int pod_hkdf_sha256(const uint8_t *ikm, size_t ikm_len, const uint8_t *info, size_t info_len,
		    uint8_t *out, size_t out_len)
{
	psa_key_derivation_operation_t op = PSA_KEY_DERIVATION_OPERATION_INIT;
	psa_algorithm_t alg = PSA_ALG_HKDF(PSA_ALG_SHA_256);
	psa_status_t st;

	st = psa_key_derivation_setup(&op, alg);
	if (st == PSA_SUCCESS) {
		/* Empty salt (RFC 5869: HMAC key of HashLen zero bytes). */
		st = psa_key_derivation_input_bytes(&op, PSA_KEY_DERIVATION_INPUT_SALT, NULL, 0);
	}
	if (st == PSA_SUCCESS) {
		st = psa_key_derivation_input_bytes(&op, PSA_KEY_DERIVATION_INPUT_SECRET, ikm,
						    ikm_len);
	}
	if (st == PSA_SUCCESS) {
		st = psa_key_derivation_input_bytes(&op, PSA_KEY_DERIVATION_INPUT_INFO, info,
						    info_len);
	}
	if (st == PSA_SUCCESS) {
		st = psa_key_derivation_output_bytes(&op, out, out_len);
	}
	psa_key_derivation_abort(&op);
	return st == PSA_SUCCESS ? POD_OK : POD_ERR_CRYPTO;
}

int pod_ct_compare(const uint8_t *a, const uint8_t *b, size_t len)
{
	uint8_t diff = 0;

	for (size_t i = 0; i < len; i++) {
		diff |= (uint8_t)(a[i] ^ b[i]);
	}
	return diff;
}
