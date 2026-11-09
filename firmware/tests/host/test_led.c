/*
 * LED pattern table (pod-v0.md): every state has its own pattern, read
 * without the colour.
 */
#include <string.h>

#include "pod/led.h"
#include "test.h"

static int same_shape(const struct pod_led_pattern *a, const struct pod_led_pattern *b)
{
	return a->breathe_ms == b->breathe_ms && a->one_shot_ms == b->one_shot_ms &&
	       a->segments_n == b->segments_n &&
	       memcmp(a->segments, b->segments, a->segments_n * sizeof(a->segments[0])) == 0;
}

static void every_state_has_a_unique_pattern(void)
{
	struct pod_led_pattern p[POD_LED_STATE_COUNT];

	for (int s = POD_LED_BOOT; s < POD_LED_STATE_COUNT; s++) {
		CHECK(pod_led_pattern((enum pod_led_state)s, 3, &p[s]));
		CHECK(p[s].breathe_ms != 0 || p[s].segments_n > 0);
	}
	for (int a = POD_LED_BOOT; a < POD_LED_STATE_COUNT; a++) {
		for (int b = a + 1; b < POD_LED_STATE_COUNT; b++) {
			if (same_shape(&p[a], &p[b])) {
				test_failures++;
				fprintf(stderr, "FAIL: LED states %d and %d share a pattern\n", a, b);
			}
			test_checks++;
		}
	}
	CHECK(!pod_led_pattern(POD_LED_STATE_COUNT, 0, &p[0]));
}

static void timings(void)
{
	struct pod_led_pattern p;

	pod_led_pattern(POD_LED_BOOT, 0, &p);
	CHECK_EQ(pod_led_intensity(&p, 0), 1000);
	CHECK_EQ(pod_led_intensity(&p, 999), 1000);
	CHECK_EQ(pod_led_intensity(&p, 1000), 0); /* one-shot: off after 1 s */

	pod_led_pattern(POD_LED_GNSS_SEARCH, 0, &p); /* 1 Hz */
	CHECK_EQ(pod_led_intensity(&p, 100), 1000);
	CHECK_EQ(pod_led_intensity(&p, 600), 0);
	CHECK_EQ(pod_led_intensity(&p, 1100), 1000);

	pod_led_pattern(POD_LED_READY, 0, &p); /* single flash every 2 s */
	CHECK_EQ(pod_led_intensity(&p, 50), 1000);
	CHECK_EQ(pod_led_intensity(&p, 150), 0);
	CHECK_EQ(pod_led_intensity(&p, 2050), 1000);

	pod_led_pattern(POD_LED_BATTERY_CRITICAL, 0, &p); /* 4 Hz for 5 s */
	CHECK_EQ(pod_led_intensity(&p, 4800), 1000);
	CHECK_EQ(pod_led_intensity(&p, 5000), 0);
	CHECK_EQ(pod_led_intensity(&p, 60000), 0);

	pod_led_pattern(POD_LED_DOCK_CHARGING, 0, &p); /* 4 s breathing */
	CHECK_EQ(pod_led_intensity(&p, 0), 0);
	CHECK_EQ(pod_led_intensity(&p, 2000), 1000);
	CHECK_EQ(pod_led_intensity(&p, 1000), 500);

	pod_led_pattern(POD_LED_SELFTEST_ERROR, 3, &p); /* 3 flashes then a 2 s pause */
	CHECK_EQ(p.segments_n, 6);
	CHECK_EQ(p.segments[5], 2000);
	CHECK_EQ(pod_led_intensity(&p, 1100), 1000); /* third flash */
	CHECK_EQ(pod_led_intensity(&p, 1400), 0);
}

static void dimming_by_vsys(void)
{
	struct pod_led_pattern p;
	struct pod_rgb c;

	/* Below the reference SYS: full duty. */
	CHECK_EQ(pod_led_dim_for_vsys(1000, 3000, POD_LED_VF_RED_MV), 1000);
	/* At 4,2 V the red needs (3,3 − 2,0) / (4,2 − 2,0) of the duty. */
	CHECK_EQ(pod_led_dim_for_vsys(1000, 4200, POD_LED_VF_RED_MV), 590);
	/* Docked at 4,9 V the blue gets (3,3 − 2,9) / (4,9 − 2,9). */
	CHECK_EQ(pod_led_dim_for_vsys(1000, 4900, POD_LED_VF_BLUE_MV), 200);
	pod_led_pattern(POD_LED_DFU, 0, &p);
	c = pod_led_sample(&p, 500, 500, 3300);
	CHECK_EQ(c.r, 500);
	CHECK_EQ(c.g, 0);
	CHECK_EQ(c.b, 500);
}

void run_led_tests(void)
{
	RUN(every_state_has_a_unique_pattern);
	RUN(timings);
	RUN(dimming_by_vsys);
}
