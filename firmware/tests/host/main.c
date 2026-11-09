/*
 * Host test runner: every suite against the portable library (firmware/lib).
 */
#include <stdlib.h>
#include <string.h>

#include "pod/crypto.h"
#include "test.h"

int test_failures;
int test_checks;
const char *test_current = "";

static int hex_nibble(char c)
{
	if (c >= '0' && c <= '9') {
		return c - '0';
	}
	if (c >= 'a' && c <= 'f') {
		return c - 'a' + 10;
	}
	if (c >= 'A' && c <= 'F') {
		return c - 'A' + 10;
	}
	return -1;
}

size_t hex_decode(const char *hex, uint8_t *out, size_t cap)
{
	size_t n = strlen(hex);

	if (n % 2 != 0 || n / 2 > cap) {
		fprintf(stderr, "bad hex fixture (%zu chars, cap %zu)\n", n, cap);
		exit(2);
	}
	for (size_t i = 0; i < n / 2; i++) {
		int hi = hex_nibble(hex[2 * i]);
		int lo = hex_nibble(hex[2 * i + 1]);

		if (hi < 0 || lo < 0) {
			fprintf(stderr, "bad hex digit in fixture\n");
			exit(2);
		}
		out[i] = (uint8_t)((hi << 4) | lo);
	}
	return n / 2;
}

void check_hex(const char *file, int line, const char *what, const uint8_t *buf, size_t len,
	       const char *hex)
{
	static uint8_t expected[8192];
	size_t n = hex_decode(hex, expected, sizeof(expected));

	test_checks++;
	if (n != len) {
		test_failures++;
		fprintf(stderr, "FAIL %s (%s:%d): %s is %zu B, expected %zu B\n", test_current, file,
			line, what, len, n);
		return;
	}
	for (size_t i = 0; i < n; i++) {
		if (buf[i] != expected[i]) {
			test_failures++;
			fprintf(stderr,
				"FAIL %s (%s:%d): %s differs at byte %zu: 0x%02x, expected 0x%02x\n",
				test_current, file, line, what, i, buf[i], expected[i]);
			return;
		}
	}
}

void run_crypto_tests(void);
void run_radio_tests(void);
void run_log_tests(void);
void run_gnss_tests(void);
void run_led_tests(void);
void run_power_tests(void);
void run_time_base_tests(void);

int main(void)
{
	if (pod_crypto_init() != 0) {
		fprintf(stderr, "crypto init failed\n");
		return 2;
	}
	run_crypto_tests();
	run_radio_tests();
	run_log_tests();
	run_gnss_tests();
	run_led_tests();
	run_power_tests();
	run_time_base_tests();
	printf("%d checks, %d failures\n", test_checks, test_failures);
	return test_failures == 0 ? 0 : 1;
}
