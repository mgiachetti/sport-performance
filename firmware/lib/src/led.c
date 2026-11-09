/*
 * Status LED patterns (see pod/led.h and the table of pod-v0.md).
 */
#include <string.h>

#include "pod/led.h"

#define WHITE {1000, 1000, 1000}
#define RED {1000, 0, 0}
#define YELLOW {1000, 1000, 0}
#define GREEN {0, 1000, 0}
#define BLUE {0, 0, 1000}
#define AMBER {1000, 250, 0}
#define VIOLET {1000, 0, 1000}

static void set_segments(struct pod_led_pattern *p, const uint16_t *seg, uint8_t n)
{
	memcpy(p->segments, seg, n * sizeof(seg[0]));
	p->segments_n = n;
}

bool pod_led_pattern(enum pod_led_state state, uint8_t param, struct pod_led_pattern *out)
{
	memset(out, 0, sizeof(*out));
	switch (state) {
	case POD_LED_OFF:
		return true;
	case POD_LED_BOOT: { /* solid 1 s and off */
		static const uint16_t s[] = {1000};
		const struct pod_rgb c = WHITE;

		out->color = c;
		set_segments(out, s, 1);
		out->one_shot_ms = 1000;
		return true;
	}
	case POD_LED_SELFTEST_ERROR: { /* N flashes, 2 s pause, repeat */
		const struct pod_rgb c = RED;
		uint8_t n = param < 1 ? 1 : (param > 9 ? 9 : param);

		out->color = c;
		for (uint8_t i = 0; i < n; i++) {
			out->segments[2 * i] = 200;
			out->segments[2 * i + 1] = 300;
		}
		out->segments[2 * n - 1] = 2000;
		out->segments_n = (uint8_t)(2 * n);
		return true;
	}
	case POD_LED_GNSS_SEARCH: { /* continuous blink at 1 Hz */
		static const uint16_t s[] = {500, 500};
		const struct pod_rgb c = YELLOW;

		out->color = c;
		set_segments(out, s, 2);
		return true;
	}
	case POD_LED_READY: { /* single flash every 2 s */
		static const uint16_t s[] = {100, 1900};
		const struct pod_rgb c = GREEN;

		out->color = c;
		set_segments(out, s, 2);
		return true;
	}
	case POD_LED_RECORDING: { /* triple flash every 10 s (off in match mode: caller) */
		static const uint16_t s[] = {100, 150, 100, 150, 100, 9400};
		const struct pod_rgb c = GREEN;

		out->color = c;
		set_segments(out, s, 6);
		return true;
	}
	case POD_LED_RECORDING_NO_LINK: { /* long flash (1 s) every 5 s */
		static const uint16_t s[] = {1000, 4000};
		const struct pod_rgb c = BLUE;

		out->color = c;
		set_segments(out, s, 2);
		return true;
	}
	case POD_LED_BATTERY_LOW: { /* two long flashes every 10 s */
		static const uint16_t s[] = {500, 300, 500, 8700};
		const struct pod_rgb c = RED;

		out->color = c;
		set_segments(out, s, 4);
		return true;
	}
	case POD_LED_BATTERY_CRITICAL: { /* fast blink at 4 Hz for 5 s, then off */
		static const uint16_t s[] = {125, 125};
		const struct pod_rgb c = RED;

		out->color = c;
		set_segments(out, s, 2);
		out->one_shot_ms = 5000;
		return true;
	}
	case POD_LED_DOCK_CHARGING: { /* slow breathing (4 s cycle) */
		const struct pod_rgb c = AMBER;

		out->color = c;
		out->breathe_ms = 4000;
		return true;
	}
	case POD_LED_DOCK_FULL: { /* solid */
		static const uint16_t s[] = {1000};
		const struct pod_rgb c = GREEN;

		out->color = c;
		set_segments(out, s, 1);
		return true;
	}
	case POD_LED_DOCK_DOWNLOAD: { /* continuous double flash (every 1 s) */
		static const uint16_t s[] = {100, 100, 100, 700};
		const struct pod_rgb c = BLUE;

		out->color = c;
		set_segments(out, s, 4);
		return true;
	}
	case POD_LED_DOCK_ERROR: { /* solid with a cut every 2 s */
		static const uint16_t s[] = {1800, 200};
		const struct pod_rgb c = RED;

		out->color = c;
		set_segments(out, s, 2);
		return true;
	}
	case POD_LED_DFU: { /* fast breathing (1 s cycle) */
		const struct pod_rgb c = VIOLET;

		out->color = c;
		out->breathe_ms = 1000;
		return true;
	}
	case POD_LED_FIND_ME: { /* burst of 10 fast flashes, 1 s pause, repeat */
		const struct pod_rgb c = WHITE;

		out->color = c;
		for (uint8_t i = 0; i < 10; i++) {
			out->segments[2 * i] = 50;
			out->segments[2 * i + 1] = 50;
		}
		out->segments[19] = 1050;
		out->segments_n = 20;
		return true;
	}
	default:
		return false;
	}
}

uint16_t pod_led_intensity(const struct pod_led_pattern *p, uint32_t t_ms)
{
	uint32_t period = 0;
	uint32_t pos;

	if (p->one_shot_ms != 0 && t_ms >= p->one_shot_ms) {
		return 0;
	}
	if (p->breathe_ms != 0) {
		uint32_t half = p->breathe_ms / 2u;

		pos = t_ms % p->breathe_ms;
		return (uint16_t)(pos < half ? pos * 1000u / half : (p->breathe_ms - pos) * 1000u / half);
	}
	if (p->segments_n == 0) {
		return 0;
	}
	if (p->segments_n == 1) {
		return 1000; /* solid */
	}
	for (uint8_t i = 0; i < p->segments_n; i++) {
		period += p->segments[i];
	}
	pos = t_ms % period;
	for (uint8_t i = 0; i < p->segments_n; i++) {
		if (pos < p->segments[i]) {
			return (i % 2u) == 0 ? 1000 : 0;
		}
		pos -= p->segments[i];
	}
	return 0;
}

uint16_t pod_led_dim_for_vsys(uint16_t duty_permille, uint16_t vsys_mv, uint16_t vf_mv)
{
	uint32_t num, den, duty;

	if (vsys_mv <= vf_mv || POD_LED_VREF_MV <= vf_mv) {
		return duty_permille; /* no headroom: full duty, it is already dimmer */
	}
	num = POD_LED_VREF_MV - vf_mv;
	den = (uint32_t)vsys_mv - vf_mv;
	if (den <= num) {
		return duty_permille;
	}
	duty = (uint32_t)duty_permille * num / den;
	return (uint16_t)duty;
}

struct pod_rgb pod_led_sample(const struct pod_led_pattern *p, uint32_t t_ms,
			      uint16_t brightness_permille, uint16_t vsys_mv)
{
	uint32_t level = (uint32_t)pod_led_intensity(p, t_ms) * brightness_permille / 1000u;
	struct pod_rgb out;

	out.r = pod_led_dim_for_vsys((uint16_t)(p->color.r * level / 1000u), vsys_mv,
				     POD_LED_VF_RED_MV);
	out.g = pod_led_dim_for_vsys((uint16_t)(p->color.g * level / 1000u), vsys_mv,
				     POD_LED_VF_GREEN_MV);
	out.b = pod_led_dim_for_vsys((uint16_t)(p->color.b * level / 1000u), vsys_mv,
				     POD_LED_VF_BLUE_MV);
	return out;
}
