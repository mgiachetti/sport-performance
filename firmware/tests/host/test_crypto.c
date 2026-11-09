/*
 * Known-answer tests of the crypto backend against the standards, so a
 * fixture mismatch elsewhere points at the format and not at AES.
 */
#include <string.h>

#include "pod/crypto.h"
#include "pod/errors.h"
#include "pod/selftest.h"
#include "test.h"

static void aes_fips197(void)
{
	uint8_t key[16], pt[16], zero[16] = {0}, out[16];

	hex_decode("000102030405060708090a0b0c0d0e0f", key, 16);
	hex_decode("00112233445566778899aabbccddeeff", pt, 16);
	/* CTR over a zero block with IV = pt gives E(pt). */
	CHECK_EQ(pod_aes128_ctr(key, pt, zero, out, 16), POD_OK);
	CHECK_HEX(out, 16, "69c4e0d86a7b0430d8cdb78070b4c55a");
}

static void ctr_sp800_38a(void)
{
	uint8_t key[16], iv[16], pt[64], out[64];

	hex_decode("2b7e151628aed2a6abf7158809cf4f3c", key, 16);
	hex_decode("f0f1f2f3f4f5f6f7f8f9fafbfcfdfeff", iv, 16);
	hex_decode("6bc1bee22e409f96e93d7e117393172aae2d8a571e03ac9c9eb76fac45af8e51"
		   "30c81c46a35ce411e5fbc1191a0a52eff69f2445df4f9b17ad2b417be66c3710",
		   pt, 64);
	pod_aes128_ctr(key, iv, pt, out, 64);
	CHECK_HEX(out, 64,
		  "874d6191b620e3261bef6864990db6ce9806f66b7970fdff8617187bb9fffdff"
		  "5ae4df3edbd5d35e5b4f09020db03eab1e031dda2fbe03d1792170a0f3009cee");
}

static void cmac_rfc4493(void)
{
	uint8_t key[16], msg[64], mac[16];

	hex_decode("2b7e151628aed2a6abf7158809cf4f3c", key, 16);
	hex_decode("6bc1bee22e409f96e93d7e117393172aae2d8a571e03ac9c9eb76fac45af8e51"
		   "30c81c46a35ce411e5fbc1191a0a52eff69f2445df4f9b17ad2b417be66c3710",
		   msg, 64);
	pod_aes128_cmac(key, msg, 0, mac);
	CHECK_HEX(mac, 16, "bb1d6929e95937287fa37d129b756746");
	pod_aes128_cmac(key, msg, 16, mac);
	CHECK_HEX(mac, 16, "070a16b46b4d4144f79bdd9dd04a287c");
	pod_aes128_cmac(key, msg, 40, mac);
	CHECK_HEX(mac, 16, "dfa66747de9ae63030ca32611497c827");
	pod_aes128_cmac(key, msg, 64, mac);
	CHECK_HEX(mac, 16, "51f0bebf7e3b9d92fc49741779363cfe");
}

static void hkdf_rfc5869_case3(void)
{
	uint8_t ikm[22], okm[42];

	memset(ikm, 0x0b, sizeof(ikm));
	CHECK_EQ(pod_hkdf_sha256(ikm, sizeof(ikm), NULL, 0, okm, sizeof(okm)), POD_OK);
	CHECK_HEX(okm, 42,
		  "8da4e775a563c18f715f802a063c5a31b8a11f5c5ee1879ec3454e5f3c738d2d"
		  "9d201395faa4b61a96c8");
}

static void ccm_rfc3610_vector1(void)
{
	uint8_t key[16], nonce[13], aad[8], pt[23], out[31], back[23];

	hex_decode("c0c1c2c3c4c5c6c7c8c9cacbcccdcecf", key, 16);
	hex_decode("00000003020100a0a1a2a3a4a5", nonce, 13);
	hex_decode("0001020304050607", aad, 8);
	hex_decode("08090a0b0c0d0e0f101112131415161718191a1b1c1d1e", pt, 23);
	CHECK_EQ(pod_aes128_ccm_seal(key, nonce, aad, 8, pt, 23, out, 8), POD_OK);
	CHECK_HEX(out, 31, "588c979a61c663d2f066d0c2c0f989806d5f6b61dac38417e8d12cfdf926e0");
	CHECK_EQ(pod_aes128_ccm_open(key, nonce, aad, 8, out, 31, back, 8), POD_OK);
	CHECK(memcmp(back, pt, 23) == 0);
	out[30] ^= 1;
	CHECK_EQ(pod_aes128_ccm_open(key, nonce, aad, 8, out, 31, back, 8), POD_ERR_AUTH);
}

static void boot_selftest(void)
{
	CHECK_EQ(pod_crypto_selftest(), 0);
}

void run_crypto_tests(void)
{
	RUN(boot_selftest);
	RUN(aes_fips197);
	RUN(ctr_sp800_38a);
	RUN(cmac_rfc4493);
	RUN(hkdf_rfc5869_case3);
	RUN(ccm_rfc3610_vector1);
}
