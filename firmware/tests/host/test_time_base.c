/*
 * RTC extension, PPS anchors from the PPI captures and TDMA slot timing.
 */
#include "pod/radio.h"
#include "pod/time_base.h"
#include "test.h"

static void rtc_extension(void)
{
	CHECK_EQ(pod_rtc_extend(0, 5), 5);
	CHECK_EQ(pod_rtc_extend(0xFFFFF0, 0x10), 0x1000010);
	CHECK_EQ(pod_rtc_extend(0x1000010, 0x20), 0x1000020);
}

static void pps_anchor(void)
{
	struct pod_pps_capture c = {.tick_at_capture = 1000, .timer_at_tick = 100,
				    .timer_at_pps = 344};
	struct pod_pps_anchor a = pod_pps_anchor_from_capture(&c);

	CHECK_EQ(a.tick, 1000);
	CHECK_EQ(a.sub_tick_ns, 15250); /* 244 counts × 62,5 ns */

	c.timer_at_pps = 700; /* 600 counts: one whole tick and 111,72 counts */
	a = pod_pps_anchor_from_capture(&c);
	CHECK_EQ(a.tick, 1001);
	CHECK_EQ(a.sub_tick_ns, 6982);

	c.timer_at_tick = 0xFFFFFF00u; /* TIMER wrapped between the two captures */
	c.timer_at_pps = 0x44;
	a = pod_pps_anchor_from_capture(&c);
	CHECK_EQ(a.tick, 1000);
	CHECK_EQ(a.sub_tick_ns, 20250);
}

static void pps_anchor_from_later_tick(void)
{
	/* PPS 244 counts before the tick 1000: it was 15 267 ns after the tick 999. */
	struct pod_pps_anchor a = pod_pps_anchor_from_later_tick(1000, 1000, 756);

	CHECK_EQ(a.tick, 999);
	CHECK_EQ(a.sub_tick_ns, 15267);
	/* Exactly on the tick. */
	a = pod_pps_anchor_from_later_tick(1000, 5000, 5000);
	CHECK_EQ(a.tick, 1000);
	CHECK_EQ(a.sub_tick_ns, 0);
	/* Polled 100 ms later (3277 ticks) and across a TIMER wrap. */
	a = pod_pps_anchor_from_later_tick(10000, 0x00100000u, 0x00100000u - 1600000u);
	CHECK_EQ(a.tick, 10000 - 3277);
	CHECK(a.sub_tick_ns < 30518);
}

static void crystal_rate(void)
{
	struct pod_pps_anchor a = {.tick = 0, .sub_tick_ns = 0};
	struct pod_pps_anchor b = {.tick = 32768u * 10u + 1u, .sub_tick_ns = 0};

	/* One tick more than nominal over 10 s: +3,05 ppm. */
	CHECK_EQ(pod_rtc_rate_ppb(&a, &b, 10), 3051);
	b.tick = 32768u * 10u;
	CHECK_EQ(pod_rtc_rate_ppb(&a, &b, 10), 0);
	CHECK_EQ(pod_rtc_rate_ppb(&a, &b, 0), 0);
}

static void tdma_slots(void)
{
	struct pod_pps_anchor frame = {.tick = 1000, .sub_tick_ns = 0};

	CHECK_EQ(pod_tdma_slot_offset_ms(0), 123);
	CHECK_EQ(pod_tdma_slot_offset_ms(1), 238);
	/* The last slot still ends inside the 2 s frame. */
	CHECK(pod_tdma_slot_offset_ms(POD_SLOTS_PER_CHANNEL - 1) + POD_SLOT_MS - POD_GUARD_MS <=
	      POD_FRAME_MS);
	CHECK_EQ(pod_tdma_slot_tick(&frame, 1, 0), 1000 + 7798);
	/* A fast crystal (+100 ppm) needs a few more ticks for the same GNSS time. */
	CHECK(pod_tdma_slot_tick(&frame, 15, 100000) > pod_tdma_slot_tick(&frame, 15, 0));
}

void run_time_base_tests(void)
{
	RUN(rtc_extension);
	RUN(pps_anchor);
	RUN(pps_anchor_from_later_tick);
	RUN(crystal_rate);
	RUN(tdma_slots);
}
