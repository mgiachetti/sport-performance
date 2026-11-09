/*
 * Boot self-test. The positive codes are the N of the LED error pattern
 * ("N destellos, pausa de 2 s") so the bench reads which check failed.
 */
#ifndef POD_SELFTEST_H_
#define POD_SELFTEST_H_

enum pod_selftest_code {
	POD_SELFTEST_CCM = 1,
	POD_SELFTEST_CMAC = 2,
	POD_SELFTEST_CTR = 3,
	POD_SELFTEST_HKDF = 4,
	POD_SELFTEST_UPLINK = 5,
	/* Peripherals (app/src/main.c). */
	POD_SELFTEST_IMU = 6,
	POD_SELFTEST_NAND = 7,
	POD_SELFTEST_GNSS = 8,
	POD_SELFTEST_LORA = 9,
};

/** Known-answer tests of the crypto backend; 0 when every vector matches. */
int pod_crypto_selftest(void);

#endif /* POD_SELFTEST_H_ */
