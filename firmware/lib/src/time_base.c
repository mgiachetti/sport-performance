/*
 * Time base arithmetic (see pod/time_base.h).
 */
#include "pod/radio.h"
#include "pod/time_base.h"

uint64_t pod_rtc_extend(uint64_t last_tick48, uint32_t counter24)
{
	uint64_t high = last_tick48 & ~0xFFFFFFull;
	uint64_t candidate = high | (counter24 & 0xFFFFFFu);

	if (candidate < last_tick48) {
		candidate += 0x1000000ull; /* the 24-bit counter wrapped */
	}
	return candidate & 0xFFFFFFFFFFFFull;
}

struct pod_pps_anchor pod_pps_anchor_from_capture(const struct pod_pps_capture *c)
{
	struct pod_pps_anchor a;
	uint32_t counts = c->timer_at_pps - c->timer_at_tick; /* modulo 2^32: wrap-safe */
	uint64_t counts_q8 = (uint64_t)counts << 8;
	uint64_t whole_ticks = counts_q8 / POD_TIMER_COUNTS_PER_TICK_Q8;
	uint64_t rest_q8 = counts_q8 - whole_ticks * POD_TIMER_COUNTS_PER_TICK_Q8;

	a.tick = c->tick_at_capture + whole_ticks;
	/* rest in TIMER counts (Q8) × 62,5 ns = rest_q8 × 125 / 512 */
	a.sub_tick_ns = (uint16_t)((rest_q8 * 125u) / 512u);
	if (a.sub_tick_ns > 30517u) {
		a.sub_tick_ns = 30517u;
	}
	return a;
}

struct pod_pps_anchor pod_pps_anchor_from_later_tick(uint64_t tick_after,
						     uint32_t timer_at_tick_after,
						     uint32_t timer_at_pps)
{
	struct pod_pps_anchor a;
	uint32_t counts = timer_at_tick_after - timer_at_pps; /* modulo 2^32 */
	uint64_t back_q8 = (uint64_t)counts << 8;
	/* Ticks back to the last tick at or before the PPS (ceil). */
	uint64_t ticks_back = (back_q8 + POD_TIMER_COUNTS_PER_TICK_Q8 - 1u) /
			      POD_TIMER_COUNTS_PER_TICK_Q8;
	uint64_t rest_q8 = ticks_back * POD_TIMER_COUNTS_PER_TICK_Q8 - back_q8;

	a.tick = tick_after - ticks_back;
	a.sub_tick_ns = (uint16_t)((rest_q8 * 125u) / 512u);
	if (a.sub_tick_ns > 30517u) {
		a.sub_tick_ns = 30517u;
	}
	return a;
}

int32_t pod_rtc_rate_ppb(const struct pod_pps_anchor *a, const struct pod_pps_anchor *b,
			 uint32_t gnss_seconds_between)
{
	/* Elapsed in ns on the RTC time line vs nominal. */
	int64_t ticks = (int64_t)(b->tick - a->tick);
	int64_t measured_ns = ticks * 1000000000ll / POD_RTC_HZ + (int64_t)b->sub_tick_ns -
			      (int64_t)a->sub_tick_ns;
	int64_t nominal_ns = (int64_t)gnss_seconds_between * 1000000000ll;

	if (gnss_seconds_between == 0) {
		return 0;
	}
	/* RTC fast → it counts more ticks than nominal → positive ppb. */
	return (int32_t)((measured_ns - nominal_ns) * 1000000000ll / nominal_ns);
}

uint32_t pod_tdma_slot_offset_ms(uint8_t slot)
{
	return POD_BEACON_WINDOW_MS + (uint32_t)slot * POD_SLOT_MS + POD_GUARD_MS;
}

uint64_t pod_tdma_slot_tick(const struct pod_pps_anchor *frame_start, uint8_t slot,
			    int32_t rate_ppb)
{
	int64_t offset_ns = (int64_t)pod_tdma_slot_offset_ms(slot) * 1000000ll;
	/* RTC ticks for that many GNSS ns at the measured rate. */
	int64_t corrected_ns = offset_ns + offset_ns * rate_ppb / 1000000000ll +
			       (int64_t)frame_start->sub_tick_ns;

	return frame_start->tick + (uint64_t)((corrected_ns * POD_RTC_HZ) / 1000000000ll);
}
