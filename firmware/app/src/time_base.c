/*
 * Time base hardware (pod-v0.md, "PPS por PPI"):
 *
 * - RTC2 runs free on the LFXO (prescaler 0, 32 768 Hz): the record tick,
 *   extended to 48 bits in software (pod_rtc_extend).
 * - TIMER2 runs at 16 MHz from the HFXO, 32 bits.
 * - Every RTC2 TICK event captures TIMER2 into CC[1] (PPI), and the PPS edge
 *   captures TIMER2 into CC[0] (GPIOTE → PPI): no CPU on the edge. The main
 *   loop polls CC[0]; the arithmetic is firmware/lib/src/time_base.c.
 *
 * TODO(B-904): keep the HFXO on while capturing (onoff request of the clock
 * control), allocate the GPIOTE and PPI channels from nrfx instead of fixed
 * numbers once the BLE stack is in, and measure the cost of the TICK event
 * routing on the bench.
 */
#include <zephyr/drivers/gpio.h>
#include <zephyr/kernel.h>
#include <zephyr/logging/log.h>
#include <zephyr/sys/util.h>

#include <hal/nrf_gpiote.h>
#include <hal/nrf_ppi.h>
#include <hal/nrf_rtc.h>
#include <hal/nrf_timer.h>
#include <soc.h>

#include "pod_app.h"

LOG_MODULE_REGISTER(pod_time, CONFIG_POD_LOG_LEVEL);

#define USER_NODE DT_PATH(zephyr_user)
#define PPS_PSEL NRF_DT_GPIOS_TO_PSEL(USER_NODE, gnss_pps_gpios)

#define TICK_RTC NRF_RTC2
#define CAPTURE_TIMER NRF_TIMER2
#define GPIOTE_CH CONFIG_POD_PPS_GPIOTE_CHANNEL
#define PPI_PPS ((nrf_ppi_channel_t)CONFIG_POD_PPS_PPI_CHANNEL_PPS)
#define PPI_TICK ((nrf_ppi_channel_t)CONFIG_POD_PPS_PPI_CHANNEL_TICK)

static struct k_spinlock lock;
static uint64_t last_tick48;
static uint32_t last_pps_capture;

int pod_time_base_init(void)
{
	/* RTC2: 32 768 Hz, TICK event routed (no interrupt). */
	nrf_rtc_prescaler_set(TICK_RTC, 0);
	nrf_rtc_event_enable(TICK_RTC, NRF_RTC_INT_TICK_MASK);
	nrf_rtc_task_trigger(TICK_RTC, NRF_RTC_TASK_CLEAR);
	nrf_rtc_task_trigger(TICK_RTC, NRF_RTC_TASK_START);

	/* TIMER2: 16 MHz, 32 bits. */
	nrf_timer_mode_set(CAPTURE_TIMER, NRF_TIMER_MODE_TIMER);
	nrf_timer_bit_width_set(CAPTURE_TIMER, NRF_TIMER_BIT_WIDTH_32);
	nrf_timer_prescaler_set(CAPTURE_TIMER, 0);
	nrf_timer_task_trigger(CAPTURE_TIMER, NRF_TIMER_TASK_CLEAR);
	nrf_timer_task_trigger(CAPTURE_TIMER, NRF_TIMER_TASK_START);

	/* PPS rising edge → GPIOTE IN event (the translator keeps the polarity: high pulse). */
	nrf_gpiote_event_configure(NRF_GPIOTE, GPIOTE_CH, PPS_PSEL, NRF_GPIOTE_POLARITY_LOTOHI);
	nrf_gpiote_event_enable(NRF_GPIOTE, GPIOTE_CH);

	nrf_ppi_channel_endpoint_setup(
		NRF_PPI, PPI_PPS,
		nrf_gpiote_event_address_get(NRF_GPIOTE, nrf_gpiote_in_event_get(GPIOTE_CH)),
		nrf_timer_task_address_get(CAPTURE_TIMER, NRF_TIMER_TASK_CAPTURE0));
	nrf_ppi_channel_endpoint_setup(
		NRF_PPI, PPI_TICK, nrf_rtc_event_address_get(TICK_RTC, NRF_RTC_EVENT_TICK),
		nrf_timer_task_address_get(CAPTURE_TIMER, NRF_TIMER_TASK_CAPTURE1));
	nrf_ppi_channel_enable(NRF_PPI, PPI_PPS);
	nrf_ppi_channel_enable(NRF_PPI, PPI_TICK);

	last_pps_capture = nrf_timer_cc_get(CAPTURE_TIMER, NRF_TIMER_CC_CHANNEL0);
	return 0;
}

uint64_t pod_tick_now(void)
{
	k_spinlock_key_t key = k_spin_lock(&lock);

	last_tick48 = pod_rtc_extend(last_tick48, nrf_rtc_counter_get(TICK_RTC));
	k_spin_unlock(&lock, key);
	return last_tick48;
}

bool pod_time_base_poll_pps(struct pod_pps_anchor *anchor)
{
	uint32_t pps = nrf_timer_cc_get(CAPTURE_TIMER, NRF_TIMER_CC_CHANNEL0);
	uint32_t timer_at_tick;
	uint64_t tick;

	if (pps == last_pps_capture) {
		return false;
	}
	/*
	 * A consistent (tick, TIMER at that tick) pair: CC[1] is latched by the
	 * TICK event that made the COUNTER reach its current value. Retry if a tick
	 * landed between the reads.
	 */
	do {
		tick = pod_tick_now();
		timer_at_tick = nrf_timer_cc_get(CAPTURE_TIMER, NRF_TIMER_CC_CHANNEL1);
	} while (pod_tick_now() != tick);

	*anchor = pod_pps_anchor_from_later_tick(tick, timer_at_tick, pps);
	last_pps_capture = pps;
	return true;
}
