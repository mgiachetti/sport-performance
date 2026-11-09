/*
 * Reference software backend of pod/crypto.h, for the host tests only.
 *
 * Not constant-time (table lookups in AES) and never linked into a target image:
 * the target uses crypto_psa.c on the CryptoCell-310. Small and readable on
 * purpose: it exists so the formats can be checked byte for byte against the
 * TypeScript golden fixtures on any machine.
 */
#include <string.h>

#include "pod/crypto.h"
#include "pod/errors.h"

/* ------------------------------------------------------------------------ */
/* AES-128 (FIPS-197), encryption only: CTR, CMAC and CCM never decrypt a block. */

static const uint8_t sbox[256] = {
	0x63, 0x7c, 0x77, 0x7b, 0xf2, 0x6b, 0x6f, 0xc5, 0x30, 0x01, 0x67, 0x2b, 0xfe, 0xd7, 0xab, 0x76,
	0xca, 0x82, 0xc9, 0x7d, 0xfa, 0x59, 0x47, 0xf0, 0xad, 0xd4, 0xa2, 0xaf, 0x9c, 0xa4, 0x72, 0xc0,
	0xb7, 0xfd, 0x93, 0x26, 0x36, 0x3f, 0xf7, 0xcc, 0x34, 0xa5, 0xe5, 0xf1, 0x71, 0xd8, 0x31, 0x15,
	0x04, 0xc7, 0x23, 0xc3, 0x18, 0x96, 0x05, 0x9a, 0x07, 0x12, 0x80, 0xe2, 0xeb, 0x27, 0xb2, 0x75,
	0x09, 0x83, 0x2c, 0x1a, 0x1b, 0x6e, 0x5a, 0xa0, 0x52, 0x3b, 0xd6, 0xb3, 0x29, 0xe3, 0x2f, 0x84,
	0x53, 0xd1, 0x00, 0xed, 0x20, 0xfc, 0xb1, 0x5b, 0x6a, 0xcb, 0xbe, 0x39, 0x4a, 0x4c, 0x58, 0xcf,
	0xd0, 0xef, 0xaa, 0xfb, 0x43, 0x4d, 0x33, 0x85, 0x45, 0xf9, 0x02, 0x7f, 0x50, 0x3c, 0x9f, 0xa8,
	0x51, 0xa3, 0x40, 0x8f, 0x92, 0x9d, 0x38, 0xf5, 0xbc, 0xb6, 0xda, 0x21, 0x10, 0xff, 0xf3, 0xd2,
	0xcd, 0x0c, 0x13, 0xec, 0x5f, 0x97, 0x44, 0x17, 0xc4, 0xa7, 0x7e, 0x3d, 0x64, 0x5d, 0x19, 0x73,
	0x60, 0x81, 0x4f, 0xdc, 0x22, 0x2a, 0x90, 0x88, 0x46, 0xee, 0xb8, 0x14, 0xde, 0x5e, 0x0b, 0xdb,
	0xe0, 0x32, 0x3a, 0x0a, 0x49, 0x06, 0x24, 0x5c, 0xc2, 0xd3, 0xac, 0x62, 0x91, 0x95, 0xe4, 0x79,
	0xe7, 0xc8, 0x37, 0x6d, 0x8d, 0xd5, 0x4e, 0xa9, 0x6c, 0x56, 0xf4, 0xea, 0x65, 0x7a, 0xae, 0x08,
	0xba, 0x78, 0x25, 0x2e, 0x1c, 0xa6, 0xb4, 0xc6, 0xe8, 0xdd, 0x74, 0x1f, 0x4b, 0xbd, 0x8b, 0x8a,
	0x70, 0x3e, 0xb5, 0x66, 0x48, 0x03, 0xf6, 0x0e, 0x61, 0x35, 0x57, 0xb9, 0x86, 0xc1, 0x1d, 0x9e,
	0xe1, 0xf8, 0x98, 0x11, 0x69, 0xd9, 0x8e, 0x94, 0x9b, 0x1e, 0x87, 0xe9, 0xce, 0x55, 0x28, 0xdf,
	0x8c, 0xa1, 0x89, 0x0d, 0xbf, 0xe6, 0x42, 0x68, 0x41, 0x99, 0x2d, 0x0f, 0xb0, 0x54, 0xbb, 0x16,
};

struct aes128 {
	uint8_t rk[176];
};

static uint8_t xtime(uint8_t x)
{
	return (uint8_t)((x << 1) ^ ((x & 0x80u) ? 0x1bu : 0x00u));
}

static void aes128_init(struct aes128 *ctx, const uint8_t key[16])
{
	static const uint8_t rcon[10] = {0x01, 0x02, 0x04, 0x08, 0x10, 0x20, 0x40, 0x80, 0x1b, 0x36};

	memcpy(ctx->rk, key, 16);
	for (unsigned int i = 4; i < 44; i++) {
		uint8_t t[4];

		memcpy(t, &ctx->rk[(i - 1) * 4], 4);
		if (i % 4 == 0) {
			uint8_t first = t[0];

			t[0] = (uint8_t)(sbox[t[1]] ^ rcon[i / 4 - 1]);
			t[1] = sbox[t[2]];
			t[2] = sbox[t[3]];
			t[3] = sbox[first];
		}
		for (unsigned int j = 0; j < 4; j++) {
			ctx->rk[i * 4 + j] = (uint8_t)(ctx->rk[(i - 4) * 4 + j] ^ t[j]);
		}
	}
}

static void aes128_encrypt(const struct aes128 *ctx, const uint8_t in[16], uint8_t out[16])
{
	uint8_t s[16];

	for (unsigned int i = 0; i < 16; i++) {
		s[i] = (uint8_t)(in[i] ^ ctx->rk[i]);
	}
	for (unsigned int round = 1; round <= 10; round++) {
		uint8_t t[16];

		/* SubBytes + ShiftRows (state is column-major: s[col * 4 + row]). */
		for (unsigned int c = 0; c < 4; c++) {
			for (unsigned int r = 0; r < 4; r++) {
				t[c * 4 + r] = sbox[s[((c + r) % 4) * 4 + r]];
			}
		}
		if (round != 10) {
			for (unsigned int c = 0; c < 4; c++) {
				uint8_t *col = &t[c * 4];
				uint8_t a0 = col[0], a1 = col[1], a2 = col[2], a3 = col[3];
				uint8_t all = (uint8_t)(a0 ^ a1 ^ a2 ^ a3);

				col[0] = (uint8_t)(a0 ^ all ^ xtime((uint8_t)(a0 ^ a1)));
				col[1] = (uint8_t)(a1 ^ all ^ xtime((uint8_t)(a1 ^ a2)));
				col[2] = (uint8_t)(a2 ^ all ^ xtime((uint8_t)(a2 ^ a3)));
				col[3] = (uint8_t)(a3 ^ all ^ xtime((uint8_t)(a3 ^ a0)));
			}
		}
		for (unsigned int i = 0; i < 16; i++) {
			s[i] = (uint8_t)(t[i] ^ ctx->rk[round * 16 + i]);
		}
	}
	memcpy(out, s, 16);
}

/* ------------------------------------------------------------------------ */
/* SHA-256 (FIPS 180-4), HMAC (RFC 2104) and HKDF (RFC 5869). */

struct sha256 {
	uint32_t h[8];
	uint8_t block[64];
	size_t block_len;
	uint64_t total_len;
};

static const uint32_t sha256_k[64] = {
	0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4,
	0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe,
	0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f,
	0x4a7484aa, 0x5cb0a9dc, 0x76f988da, 0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7,
	0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc,
	0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b,
	0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070, 0x19a4c116,
	0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
	0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7,
	0xc67178f2,
};

static uint32_t rotr(uint32_t x, unsigned int n)
{
	return (x >> n) | (x << (32u - n));
}

static void sha256_compress(struct sha256 *ctx, const uint8_t block[64])
{
	uint32_t w[64];
	uint32_t a, b, c, d, e, f, g, h;

	for (unsigned int i = 0; i < 16; i++) {
		w[i] = ((uint32_t)block[i * 4] << 24) | ((uint32_t)block[i * 4 + 1] << 16) |
		       ((uint32_t)block[i * 4 + 2] << 8) | (uint32_t)block[i * 4 + 3];
	}
	for (unsigned int i = 16; i < 64; i++) {
		uint32_t s0 = rotr(w[i - 15], 7) ^ rotr(w[i - 15], 18) ^ (w[i - 15] >> 3);
		uint32_t s1 = rotr(w[i - 2], 17) ^ rotr(w[i - 2], 19) ^ (w[i - 2] >> 10);

		w[i] = w[i - 16] + s0 + w[i - 7] + s1;
	}
	a = ctx->h[0];
	b = ctx->h[1];
	c = ctx->h[2];
	d = ctx->h[3];
	e = ctx->h[4];
	f = ctx->h[5];
	g = ctx->h[6];
	h = ctx->h[7];
	for (unsigned int i = 0; i < 64; i++) {
		uint32_t s1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
		uint32_t ch = (e & f) ^ (~e & g);
		uint32_t t1 = h + s1 + ch + sha256_k[i] + w[i];
		uint32_t s0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
		uint32_t maj = (a & b) ^ (a & c) ^ (b & c);
		uint32_t t2 = s0 + maj;

		h = g;
		g = f;
		f = e;
		e = d + t1;
		d = c;
		c = b;
		b = a;
		a = t1 + t2;
	}
	ctx->h[0] += a;
	ctx->h[1] += b;
	ctx->h[2] += c;
	ctx->h[3] += d;
	ctx->h[4] += e;
	ctx->h[5] += f;
	ctx->h[6] += g;
	ctx->h[7] += h;
}

static void sha256_init(struct sha256 *ctx)
{
	static const uint32_t iv[8] = {0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a,
				       0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19};

	memcpy(ctx->h, iv, sizeof(iv));
	ctx->block_len = 0;
	ctx->total_len = 0;
}

static void sha256_update(struct sha256 *ctx, const uint8_t *data, size_t len)
{
	ctx->total_len += len;
	while (len > 0) {
		size_t take = 64 - ctx->block_len;

		if (take > len) {
			take = len;
		}
		memcpy(&ctx->block[ctx->block_len], data, take);
		ctx->block_len += take;
		data += take;
		len -= take;
		if (ctx->block_len == 64) {
			sha256_compress(ctx, ctx->block);
			ctx->block_len = 0;
		}
	}
}

static void sha256_final(struct sha256 *ctx, uint8_t out[32])
{
	uint64_t bits = ctx->total_len * 8u;
	uint8_t pad = 0x80;
	uint8_t zero = 0;
	uint8_t len_be[8];

	sha256_update(ctx, &pad, 1);
	while (ctx->block_len != 56) {
		sha256_update(ctx, &zero, 1);
	}
	for (unsigned int i = 0; i < 8; i++) {
		len_be[i] = (uint8_t)(bits >> (56u - 8u * i));
	}
	sha256_update(ctx, len_be, 8);
	for (unsigned int i = 0; i < 8; i++) {
		out[i * 4] = (uint8_t)(ctx->h[i] >> 24);
		out[i * 4 + 1] = (uint8_t)(ctx->h[i] >> 16);
		out[i * 4 + 2] = (uint8_t)(ctx->h[i] >> 8);
		out[i * 4 + 3] = (uint8_t)ctx->h[i];
	}
}

struct hmac_sha256 {
	struct sha256 inner;
	struct sha256 outer;
};

static void hmac_init(struct hmac_sha256 *ctx, const uint8_t *key, size_t key_len)
{
	uint8_t k[64] = {0};
	uint8_t pad[64];

	if (key_len > 64) {
		struct sha256 kh;

		sha256_init(&kh);
		sha256_update(&kh, key, key_len);
		sha256_final(&kh, k);
	} else if (key_len > 0) {
		memcpy(k, key, key_len);
	}
	for (unsigned int i = 0; i < 64; i++) {
		pad[i] = (uint8_t)(k[i] ^ 0x36u);
	}
	sha256_init(&ctx->inner);
	sha256_update(&ctx->inner, pad, 64);
	for (unsigned int i = 0; i < 64; i++) {
		pad[i] = (uint8_t)(k[i] ^ 0x5cu);
	}
	sha256_init(&ctx->outer);
	sha256_update(&ctx->outer, pad, 64);
}

static void hmac_final(struct hmac_sha256 *ctx, uint8_t out[32])
{
	uint8_t inner[32];

	sha256_final(&ctx->inner, inner);
	sha256_update(&ctx->outer, inner, 32);
	sha256_final(&ctx->outer, out);
}

int pod_hkdf_sha256(const uint8_t *ikm, size_t ikm_len, const uint8_t *info, size_t info_len,
		    uint8_t *out, size_t out_len)
{
	struct hmac_sha256 h;
	uint8_t prk[32];
	uint8_t t[32];
	size_t t_len = 0;
	size_t done = 0;
	uint8_t counter = 1;

	if (out_len > 255u * 32u) {
		return POD_ERR_LENGTH;
	}
	/* Extract with an empty salt: HMAC key = 32 zero bytes (RFC 5869 §2.2). */
	hmac_init(&h, NULL, 0);
	sha256_update(&h.inner, ikm, ikm_len);
	hmac_final(&h, prk);
	while (done < out_len) {
		size_t take;

		hmac_init(&h, prk, sizeof(prk));
		sha256_update(&h.inner, t, t_len);
		sha256_update(&h.inner, info, info_len);
		sha256_update(&h.inner, &counter, 1);
		hmac_final(&h, t);
		t_len = 32;
		take = out_len - done < 32 ? out_len - done : 32;
		memcpy(&out[done], t, take);
		done += take;
		counter++;
	}
	return POD_OK;
}

/* ------------------------------------------------------------------------ */
/* Modes. */

int pod_crypto_init(void)
{
	return POD_OK;
}

static void increment_be(uint8_t block[16])
{
	for (int i = 15; i >= 0; i--) {
		if (++block[i] != 0) {
			break;
		}
	}
}

int pod_aes128_ctr(const uint8_t key[POD_AES_KEY_LEN], const uint8_t iv[POD_AES_BLOCK_LEN],
		   const uint8_t *in, uint8_t *out, size_t len)
{
	struct aes128 aes;
	uint8_t counter[16];
	uint8_t stream[16];

	aes128_init(&aes, key);
	memcpy(counter, iv, 16);
	for (size_t off = 0; off < len; off += 16) {
		size_t n = len - off < 16 ? len - off : 16;

		aes128_encrypt(&aes, counter, stream);
		for (size_t i = 0; i < n; i++) {
			out[off + i] = (uint8_t)(in[off + i] ^ stream[i]);
		}
		increment_be(counter);
	}
	return POD_OK;
}

static void cmac_double(uint8_t b[16])
{
	uint8_t carry = (uint8_t)(b[0] & 0x80u);

	for (unsigned int i = 0; i < 15; i++) {
		b[i] = (uint8_t)((b[i] << 1) | (b[i + 1] >> 7));
	}
	b[15] = (uint8_t)(b[15] << 1);
	if (carry) {
		b[15] ^= 0x87u;
	}
}

int pod_aes128_cmac(const uint8_t key[POD_AES_KEY_LEN], const uint8_t *msg, size_t len,
		    uint8_t mac[POD_AES_BLOCK_LEN])
{
	struct aes128 aes;
	uint8_t k1[16] = {0};
	uint8_t k2[16];
	uint8_t x[16] = {0};
	uint8_t last[16];
	size_t blocks = (len + 15) / 16;
	int complete;

	aes128_init(&aes, key);
	aes128_encrypt(&aes, k1, k1);
	cmac_double(k1);
	memcpy(k2, k1, 16);
	cmac_double(k2);
	if (blocks == 0) {
		blocks = 1;
		complete = 0;
	} else {
		complete = (len % 16) == 0;
	}
	for (size_t b = 0; b + 1 < blocks; b++) {
		for (unsigned int i = 0; i < 16; i++) {
			x[i] ^= msg[b * 16 + i];
		}
		aes128_encrypt(&aes, x, x);
	}
	memset(last, 0, 16);
	{
		size_t rest = len - (blocks - 1) * 16;

		if (rest > 0) {
			memcpy(last, &msg[(blocks - 1) * 16], rest);
		}
		if (complete) {
			for (unsigned int i = 0; i < 16; i++) {
				last[i] ^= k1[i];
			}
		} else {
			last[rest] = 0x80;
			for (unsigned int i = 0; i < 16; i++) {
				last[i] ^= k2[i];
			}
		}
	}
	for (unsigned int i = 0; i < 16; i++) {
		x[i] ^= last[i];
	}
	aes128_encrypt(&aes, x, mac);
	return POD_OK;
}

static void ccm_block(uint8_t out[16], uint8_t flags, const uint8_t nonce[13], uint16_t value)
{
	out[0] = flags;
	memcpy(&out[1], nonce, 13);
	out[14] = (uint8_t)(value >> 8);
	out[15] = (uint8_t)value;
}

static int ccm_params_ok(size_t aad_len, size_t len, size_t tag_len)
{
	return tag_len >= 4 && tag_len <= 16 && (tag_len % 2) == 0 && len <= 0xffffu &&
	       aad_len < 0xff00u;
}

/* CBC-MAC of B0 ‖ encoded AAD ‖ padded message (SP 800-38C A.2). */
static void ccm_cbc_mac(const struct aes128 *aes, const uint8_t nonce[13], const uint8_t *aad,
			size_t aad_len, const uint8_t *msg, size_t len, size_t tag_len,
			uint8_t x[16])
{
	uint8_t flags = (uint8_t)((aad_len > 0 ? 0x40u : 0u) | (((tag_len - 2) / 2) << 3) | 1u);
	uint8_t block[16];
	size_t pos;

	ccm_block(block, flags, nonce, (uint16_t)len);
	aes128_encrypt(aes, block, x);
	if (aad_len > 0) {
		memset(block, 0, 16);
		block[0] = (uint8_t)(aad_len >> 8);
		block[1] = (uint8_t)aad_len;
		pos = 2;
		for (size_t i = 0; i < aad_len; i++) {
			block[pos++] = aad[i];
			if (pos == 16) {
				for (unsigned int j = 0; j < 16; j++) {
					x[j] ^= block[j];
				}
				aes128_encrypt(aes, x, x);
				memset(block, 0, 16);
				pos = 0;
			}
		}
		if (pos > 0) {
			for (unsigned int j = 0; j < 16; j++) {
				x[j] ^= block[j];
			}
			aes128_encrypt(aes, x, x);
		}
	}
	for (size_t off = 0; off < len; off += 16) {
		size_t n = len - off < 16 ? len - off : 16;

		for (size_t j = 0; j < n; j++) {
			x[j] ^= msg[off + j];
		}
		aes128_encrypt(aes, x, x);
	}
}

static void ccm_ctr(const struct aes128 *aes, const uint8_t nonce[13], const uint8_t *in,
		    uint8_t *out, size_t len)
{
	uint8_t a[16];
	uint8_t s[16];
	uint16_t counter = 1;

	for (size_t off = 0; off < len; off += 16) {
		size_t n = len - off < 16 ? len - off : 16;

		ccm_block(a, 0x01, nonce, counter++);
		aes128_encrypt(aes, a, s);
		for (size_t j = 0; j < n; j++) {
			out[off + j] = (uint8_t)(in[off + j] ^ s[j]);
		}
	}
}

int pod_aes128_ccm_seal(const uint8_t key[POD_AES_KEY_LEN], const uint8_t nonce[POD_CCM_NONCE_LEN],
			const uint8_t *aad, size_t aad_len, const uint8_t *pt, size_t pt_len,
			uint8_t *out, size_t tag_len)
{
	struct aes128 aes;
	uint8_t x[16];
	uint8_t a0[16];
	uint8_t s0[16];

	if (!ccm_params_ok(aad_len, pt_len, tag_len)) {
		return POD_ERR_LENGTH;
	}
	aes128_init(&aes, key);
	ccm_cbc_mac(&aes, nonce, aad, aad_len, pt, pt_len, tag_len, x);
	ccm_ctr(&aes, nonce, pt, out, pt_len);
	ccm_block(a0, 0x01, nonce, 0);
	aes128_encrypt(&aes, a0, s0);
	for (size_t i = 0; i < tag_len; i++) {
		out[pt_len + i] = (uint8_t)(x[i] ^ s0[i]);
	}
	return POD_OK;
}

int pod_aes128_ccm_open(const uint8_t key[POD_AES_KEY_LEN], const uint8_t nonce[POD_CCM_NONCE_LEN],
			const uint8_t *aad, size_t aad_len, const uint8_t *sealed, size_t sealed_len,
			uint8_t *out, size_t tag_len)
{
	struct aes128 aes;
	uint8_t x[16];
	uint8_t a0[16];
	uint8_t s0[16];
	uint8_t tag[16];
	size_t len;

	if (sealed_len < tag_len) {
		return POD_ERR_LENGTH;
	}
	len = sealed_len - tag_len;
	if (!ccm_params_ok(aad_len, len, tag_len)) {
		return POD_ERR_LENGTH;
	}
	aes128_init(&aes, key);
	ccm_ctr(&aes, nonce, sealed, out, len);
	ccm_cbc_mac(&aes, nonce, aad, aad_len, out, len, tag_len, x);
	ccm_block(a0, 0x01, nonce, 0);
	aes128_encrypt(&aes, a0, s0);
	for (size_t i = 0; i < tag_len; i++) {
		tag[i] = (uint8_t)(x[i] ^ s0[i]);
	}
	if (pod_ct_compare(tag, &sealed[len], tag_len) != 0) {
		memset(out, 0, len);
		return POD_ERR_AUTH;
	}
	return POD_OK;
}

int pod_ct_compare(const uint8_t *a, const uint8_t *b, size_t len)
{
	uint8_t diff = 0;

	for (size_t i = 0; i < len; i++) {
		diff |= (uint8_t)(a[i] ^ b[i]);
	}
	return diff;
}
