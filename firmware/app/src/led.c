/*
 * RGB status LED on PWM0 (three channels to the NMOS gates). The pattern table
 * is pure (firmware/lib/src/led.c, host-tested); this file only writes duties.
 */
#include <string.h>

#include <zephyr/drivers/pwm.h>
#include <zephyr/kernel.h>

#include "pod_app.h"

static const struct pwm_dt_spec red = PWM_DT_SPEC_GET(DT_ALIAS(led_red));
static const struct pwm_dt_spec green = PWM_DT_SPEC_GET(DT_ALIAS(led_green));
static const struct pwm_dt_spec blue = PWM_DT_SPEC_GET(DT_ALIAS(led_blue));

static struct pod_led_pattern pattern;
static uint32_t started_ms;
static bool restart = true;
/** Club brightness (‰); match mode lowers it or turns the LED off (beacon LED mode). */
static uint16_t brightness_permille = 1000;

int pod_led_init(void)
{
	if (!pwm_is_ready_dt(&red) || !pwm_is_ready_dt(&green) || !pwm_is_ready_dt(&blue)) {
		return -ENODEV;
	}
	pod_led_show(POD_LED_BOOT, 0);
	return 0;
}

void pod_led_show(enum pod_led_state state, uint8_t param)
{
	struct pod_led_pattern next;

	if (!pod_led_pattern(state, param, &next)) {
		return;
	}
	if (memcmp(&next, &pattern, sizeof(next)) != 0) {
		pattern = next;
		restart = true;
	}
}

static void write(const struct pwm_dt_spec *spec, uint16_t permille)
{
	(void)pwm_set_pulse_dt(spec, (uint32_t)((uint64_t)spec->period * permille / 1000u));
}

void pod_led_update(uint32_t now_ms, uint16_t vsys_mv)
{
	struct pod_rgb rgb;

	if (restart) {
		started_ms = now_ms;
		restart = false;
	}
	rgb = pod_led_sample(&pattern, now_ms - started_ms, brightness_permille, vsys_mv);
	write(&red, rgb.r);
	write(&green, rgb.g);
	write(&blue, rgb.b);
}
