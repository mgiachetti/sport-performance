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
 * The GPIOTE channel and the two PPI channels come from the nrfx allocators
 * (shared with the GPIO driver and the BLE controller), and the HFXO is
 * requested while the GNSS is on (pod_time_base_capture): the 16 MHz TIMER is
 * only as good as its clock. TODO(B-904): measure the current of the TICK event
 * routing and the HFXO on the bench.
 */
#include <zephyr/drivers/gpio.h>
#include <zephyr/kernel.h>
#include <zephyr/logging/log.h>
#include <zephyr/sys/util.h>

#include <zephyr/drivers/clock_control/nrf_clock_control.h>

#include <gpiote_nrfx.h>
#include <hal/nrf_rtc.h>
#include <helpers/nrfx_gppi.h>
#include <hal/nrf_timer.h>
#include <soc.h>

#include "pod_app.h"

LOG_MODULE_REGISTER(pod_time, CONFIG_POD_LOG_LEVEL);

#define USER_NODE DT_PATH(zephyr_user)
#define PPS_PSEL NRF_DT_GPIOS_TO_PSEL(USER_NODE, gnss_pps_gpios)

#define TICK_RTC NRF_RTC2
#define CAPTURE_TIMER NRF_TIMER2
#define GPIOTE_INST (&GPIOTE_NRFX_INST_BY_NODE(DT_NODELABEL(gpiote)))

static struct onoff_client hfxo_client;
static bool hfxo_requested;

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

	/* PPS rising edge → GPIOTE IN event (no interrupt), channel from the allocator. */
	{
		uint8_t ch;
		nrf_gpio_pin_pull_t pull = NRF_GPIO_PIN_PULLUP;
		nrfx_gpiote_trigger_config_t trigger = {
			.trigger = NRFX_GPIOTE_TRIGGER_LOTOHI,
			.p_in_channel = &ch,
		};
		nrfx_gpiote_input_pin_config_t input = {
			.p_pull_config = &pull,
			.p_trigger_config = &trigger,
			.p_handler_config = NULL,
		};
		nrfx_gppi_handle_t pps_conn, tick_conn;
		int rc = nrfx_gpiote_channel_alloc(GPIOTE_INST, &ch);

		if (rc < 0) {
			LOG_ERR("no GPIOTE channel for the PPS");
			return rc;
		}
		rc = nrfx_gpiote_input_configure(GPIOTE_INST, PPS_PSEL, &input);
		if (rc < 0) {
			return rc;
		}
		nrfx_gpiote_trigger_enable(GPIOTE_INST, PPS_PSEL, false);

		rc = nrfx_gppi_conn_alloc(
			nrfx_gpiote_in_event_address_get(GPIOTE_INST, PPS_PSEL),
			nrf_timer_task_address_get(CAPTURE_TIMER, NRF_TIMER_TASK_CAPTURE0), &pps_conn);
		if (rc < 0) {
			LOG_ERR("no PPI channel for the PPS");
			return rc;
		}
		rc = nrfx_gppi_conn_alloc(
			nrf_rtc_event_address_get(TICK_RTC, NRF_RTC_EVENT_TICK),
			nrf_timer_task_address_get(CAPTURE_TIMER, NRF_TIMER_TASK_CAPTURE1), &tick_conn);
		if (rc < 0) {
			LOG_ERR("no PPI channel for the RTC tick");
			return rc;
		}
		nrfx_gppi_conn_enable(pps_conn);
		nrfx_gppi_conn_enable(tick_conn);
	}

	last_pps_capture = nrf_timer_cc_get(CAPTURE_TIMER, NRF_TIMER_CC_CHANNEL0);
	return 0;
}

int pod_time_base_capture(bool on)
{
	struct onoff_manager *mgr = z_nrf_clock_control_get_onoff(CLOCK_CONTROL_NRF_SUBSYS_HF);
	int rc = 0;

	if (on && !hfxo_requested) {
		sys_notify_init_spinwait(&hfxo_client.notify);
		rc = onoff_request(mgr, &hfxo_client);
		hfxo_requested = rc >= 0;
	} else if (!on && hfxo_requested) {
		rc = onoff_release(mgr);
		hfxo_requested = false;
	}
	return rc < 0 ? rc : 0;
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
