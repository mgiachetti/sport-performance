/*
 * Tiny test harness for the host tests (plain C, no framework to install).
 */
#ifndef POD_TEST_H_
#define POD_TEST_H_

#include <stddef.h>
#include <stdint.h>
#include <stdio.h>

extern int test_failures;
extern int test_checks;
extern const char *test_current;

#define CHECK(cond)                                                                            \
	do {                                                                                   \
		test_checks++;                                                                 \
		if (!(cond)) {                                                                 \
			test_failures++;                                                       \
			fprintf(stderr, "FAIL %s (%s:%d): %s\n", test_current, __FILE__,       \
				__LINE__, #cond);                                              \
		}                                                                              \
	} while (0)

#define CHECK_EQ(a, b)                                                                         \
	do {                                                                                   \
		long long _a = (long long)(a), _b = (long long)(b);                            \
		test_checks++;                                                                 \
		if (_a != _b) {                                                                \
			test_failures++;                                                       \
			fprintf(stderr, "FAIL %s (%s:%d): %s == %lld, expected %s == %lld\n",  \
				test_current, __FILE__, __LINE__, #a, _a, #b, _b);              \
		}                                                                              \
	} while (0)

/** Compares bytes with a hex string, printing the first difference. */
#define CHECK_HEX(buf, len, hex) check_hex(__FILE__, __LINE__, #buf, (buf), (len), (hex))

void check_hex(const char *file, int line, const char *what, const uint8_t *buf, size_t len,
	       const char *hex);

/** Decodes a hex string into `out` (returns the length, aborts on bad input). */
size_t hex_decode(const char *hex, uint8_t *out, size_t cap);

#define RUN(fn)                                                                                \
	do {                                                                                   \
		test_current = #fn;                                                            \
		fn();                                                                          \
	} while (0)

#endif /* POD_TEST_H_ */
