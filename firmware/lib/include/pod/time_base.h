/*
 * Time base of the pod (ADR 0106, "Base de tiempo"; pod-v0.md, "PPS por PPI").
 *
 * - The record tick is the RTC on the 32,768 kHz crystal (LFXO), extended from
 *   24 to 48 bits in software, starting at each boot.
 * - The GNSS PPS edge captures a 16 MHz TIMER through GPIOTE → PPI (no CPU).
 *   Every RTC TICK event also captures the same TIMER through PPI, so the PPS
 *   is placed between two RTC ticks with 62,5 ns resolution: `time_anchor`
 *   carries the tick and the `subTickNs` after it.
 * - The TDMA slot of LoRa is scheduled in RTC ticks from the PPS anchors,
 *   corrected by the measured crystal rate.
 *
 * Pure arithmetic here; the nrfx GPIOTE/PPI/TIMER/RTC glue is app/src/time_base.c.
 */
#ifndef POD_TIME_BASE_H_
#define POD_TIME_BASE_H_

#include <stdbool.h>
#include <stdint.h>

#define POD_RTC_HZ 32768u
#define POD_TIMER_HZ 16000000u
/** TIMER counts per RTC tick: 16 MHz / 32 768 Hz = 488,28125. */
#define POD_TIMER_COUNTS_PER_TICK_Q8 125000u /* 488.28125 × 256 */

/** Extends the 24-bit RTC COUNTER to the 48-bit record tick (call more often than 512 s). */
uint64_t pod_rtc_extend(uint64_t last_tick48, uint32_t counter24);

struct pod_pps_capture {
	/** Extended RTC tick of the last TICK event captured before the PPS. */
	uint64_t tick_at_capture;
	/** TIMER value latched by that RTC TICK event (PPI). */
	uint32_t timer_at_tick;
	/** TIMER value latched by the PPS edge (GPIOTE → PPI). */
	uint32_t timer_at_pps;
};

struct pod_pps_anchor {
	uint64_t tick;
	/** ns after `tick` (0..30 517), the `subTickNs` of `time_anchor`. */
	uint16_t sub_tick_ns;
};

/**
 * Places the PPS edge on the RTC time line. Handles a TIMER wrap and a missed
 * tick capture (more than one tick between the two captures).
 */
struct pod_pps_anchor pod_pps_anchor_from_capture(const struct pod_pps_capture *c);

/**
 * Same, from an RTC tick that came after the PPS (what the main loop sees when
 * it polls): `tick_after` is the current tick, `timer_at_tick_after` the TIMER
 * latched by the TICK event that produced it, `timer_at_pps` the PPS capture.
 */
struct pod_pps_anchor pod_pps_anchor_from_later_tick(uint64_t tick_after,
						     uint32_t timer_at_tick_after,
						     uint32_t timer_at_pps);

/** Crystal rate error in ppb from two anchors one or more GNSS seconds apart. */
int32_t pod_rtc_rate_ppb(const struct pod_pps_anchor *a, const struct pod_pps_anchor *b,
			 uint32_t gnss_seconds_between);

/** Offset (ms) of a TX slot from the start of the 2 s frame: beacon window + slot + guard. */
uint32_t pod_tdma_slot_offset_ms(uint8_t slot);

/**
 * RTC tick at which the slot TX has to start, from the frame start tick (the
 * PPS anchor of the even GNSS second) and the measured rate (ppb).
 */
uint64_t pod_tdma_slot_tick(const struct pod_pps_anchor *frame_start, uint8_t slot,
			    int32_t rate_ppb);

#endif /* POD_TIME_BASE_H_ */
