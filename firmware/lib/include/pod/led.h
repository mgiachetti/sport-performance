/*
 * Status LED patterns (docs/hardware/pod-v0.md, "LED de estado"). Every state
 * has a pattern no other state repeats, so it reads without seeing the colour
 * (colour blindness, sun in the face); the colour only reinforces it.
 *
 * Pure: `pod_led_sample` gives the RGB duty (‰) at a time; app/src/led.c
 * drives PWM0 with it. Times and percentages are starting values (B-904).
 */
#ifndef POD_LED_H_
#define POD_LED_H_

#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>

enum pod_led_state {
	POD_LED_OFF = 0,
	POD_LED_BOOT,
	POD_LED_SELFTEST_ERROR,
	POD_LED_GNSS_SEARCH,
	POD_LED_READY,
	POD_LED_RECORDING,
	POD_LED_RECORDING_NO_LINK,
	POD_LED_BATTERY_LOW,
	POD_LED_BATTERY_CRITICAL,
	POD_LED_DOCK_CHARGING,
	POD_LED_DOCK_FULL,
	POD_LED_DOCK_DOWNLOAD,
	POD_LED_DOCK_ERROR,
	POD_LED_DFU,
	POD_LED_FIND_ME,
	POD_LED_STATE_COUNT,
};

struct pod_rgb {
	uint16_t r; /* ‰ of full PWM */
	uint16_t g;
	uint16_t b;
};

#define POD_LED_MAX_SEGMENTS 24

/** One pattern: alternating on/off segments over a period, or a breathing ramp. */
struct pod_led_pattern {
	/** Colour at full intensity (‰ per channel). */
	struct pod_rgb color;
	/** Breathing (triangle ramp) with this cycle; 0 = segments. */
	uint16_t breathe_ms;
	/** on, off, on, off… (ms); one segment = solid. */
	uint16_t segments[POD_LED_MAX_SEGMENTS];
	uint8_t segments_n;
	/** Plays this long and then stays off; 0 = repeats forever. */
	uint16_t one_shot_ms;
};

/**
 * Pattern of a state. `param` is N for `POD_LED_SELFTEST_ERROR` (peripheral
 * number, 1..9). Returns false for an unknown state.
 */
bool pod_led_pattern(enum pod_led_state state, uint8_t param, struct pod_led_pattern *out);

/** Intensity (‰) of a pattern `t_ms` after it started. */
uint16_t pod_led_intensity(const struct pod_led_pattern *p, uint32_t t_ms);

/**
 * PWM duty (‰) for one channel so the brightness stays even as SYS moves
 * (3,0–4,2 V on battery, 4,4–4,9 V docked): the LED current is
 * (SYS − Vf) / R, so the duty scales by (Vref − Vf) / (SYS − Vf), at most 1.
 */
uint16_t pod_led_dim_for_vsys(uint16_t duty_permille, uint16_t vsys_mv, uint16_t vf_mv);

/** Forward voltages (mV) per colour, not verified against the LED sheet. */
#define POD_LED_VF_RED_MV 2000u
#define POD_LED_VF_GREEN_MV 2900u
#define POD_LED_VF_BLUE_MV 2900u
/** SYS at which the resistors are tuned at the bench (empty-ish cell). */
#define POD_LED_VREF_MV 3300u

/** Pattern at `t_ms`, scaled by club brightness (‰) and dimmed for SYS. */
struct pod_rgb pod_led_sample(const struct pod_led_pattern *p, uint32_t t_ms,
			      uint16_t brightness_permille, uint16_t vsys_mv);

#endif /* POD_LED_H_ */
