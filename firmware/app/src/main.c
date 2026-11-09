/*
 * Pod firmware (B-904): boot, self-test and the power / LED loop.
 *
 * Boot order: watchdog first (mandatory), LED (white boot pattern), crypto
 * known-answer self-test, persistent counters (boot counter saved before any
 * TX), charger plan (EN_PUSH, 15 s watchdog, charge current), Hall, time base,
 * sensors, NAND, GNSS and LoRa. A failed self-test shows its number on the LED
 * and the pod neither records nor transmits.
 *
 * The loop feeds the inputs (VBUS, Hall, motion, battery) to the power state
 * machine of firmware/lib/src/power.c and executes its actions.
 */
#include <zephyr/kernel.h>
#include <zephyr/logging/log.h>

#include "pod/crypto.h"
#include "pod/selftest.h"
#include "pod_app.h"

LOG_MODULE_REGISTER(pod_main, CONFIG_POD_LOG_LEVEL);

static void fail_forever(int code)
{
	LOG_ERR("self-test failed: %d", code);
	pod_led_show(POD_LED_SELFTEST_ERROR, (uint8_t)code);
	for (;;) {
		pod_led_update(k_uptime_get_32(), pod_power_vsys_mv());
		pod_wdt_feed();
		k_msleep(CONFIG_POD_MAIN_LOOP_MS);
	}
}

static void log_firmware_info(void)
{
	struct pod_log_record r = {
		.type = POD_REC_FIRMWARE_INFO,
		.tick = pod_tick_now(),
		.u.firmware_info = {
			.major = POD_FIRMWARE_VERSION_MAJOR,
			.minor = POD_FIRMWARE_VERSION_MINOR,
			.patch = POD_FIRMWARE_VERSION_PATCH,
			.build_id = 0, /* TODO(B-904): first 4 B of the git commit from the build */
			.hardware_revision = CONFIG_POD_HW_REVISION,
			.algorithm_version = 1,
			.radio_protocol_version = POD_PROTOCOL_VERSION,
			.log_format_version = POD_LOG_FORMAT_VERSION,
			.gnss_firmware = pod_gnss_version(),
		},
	};

	(void)pod_log_append(&r);
}

static enum pod_led_state led_for(enum pod_power_state state, bool vbus, uint8_t battery_pct)
{
	struct pod_gnss_pvt pvt;

	if (battery_pct != 127 && battery_pct < 5) {
		return POD_LED_BATTERY_CRITICAL;
	}
	if (battery_pct != 127 && battery_pct < 20 && !vbus) {
		return POD_LED_BATTERY_LOW;
	}
	switch (state) {
	case POD_POWER_DOCKED:
		/* TODO(B-904): full, downloading and download error from the charger and USB. */
		return POD_LED_DOCK_CHARGING;
	case POD_POWER_ACTIVE:
		pod_gnss_latest(&pvt);
		/* TODO(B-904): link with the gateway (beacons) decides READY vs NO_LINK. */
		return pvt.valid ? POD_LED_RECORDING_NO_LINK : POD_LED_GNSS_SEARCH;
	default:
		return POD_LED_OFF;
	}
}

static void execute(const struct pod_power_result *r, bool in_vest)
{
	if (r->actions & POD_PWR_ACT_CLOSE_SESSION) {
		(void)pod_log_close_segment();
	}
	if (r->actions & POD_PWR_ACT_GNSS_BACKUP) {
		(void)pod_gnss_power(false);
	}
	if (r->actions & POD_PWR_ACT_LORA_OFF) {
		(void)pod_lora_power(false);
	}
	if (r->actions & POD_PWR_ACT_IMU_LOW_POWER) {
		(void)pod_sensors_low_power(true);
	}
	if (r->actions & POD_PWR_ACT_GNSS_ON) {
		(void)pod_gnss_power(true);
	}
	if (r->actions & POD_PWR_ACT_LORA_ON) {
		(void)pod_lora_power(true);
	}
	if (r->actions & POD_PWR_ACT_IMU_SESSION_RATE) {
		(void)pod_sensors_low_power(false);
	}
	if (r->actions & POD_PWR_ACT_OPEN_SESSION) {
		if (pod_log_start_segment() == 0) {
			log_firmware_info();
		}
	}
	if (r->actions & POD_PWR_ACT_SHIP_MODE) {
		(void)pod_power_ship_mode();
	}
	if (r->actions & POD_PWR_ACT_SYSTEM_OFF) {
		struct pod_power_config cfg;
		struct pod_wake_plan plan;

		/* TODO(B-904): the club configuration replaces the placeholder defaults. */
		pod_power_config_defaults(&cfg);
		plan = pod_power_wake_plan(&cfg, in_vest);
		pod_power_system_off(&plan);
	}
}

static struct pod_power_inputs read_inputs(void)
{
	struct pod_power_inputs in = {
		.now_ms = k_uptime_get_32(),
		.vbus = pod_power_vbus(),
		.in_vest = pod_hall_in_vest(),
		.moving = pod_sensors_moving(),
		.battery_pct = pod_power_battery_pct(),
		.nand_idle = pod_log_idle(),
	};

	/* TODO(B-904): app close and ship requests arrive over BLE / the beacon. */
	return in;
}

int main(void)
{
	struct pod_power_machine machine;
	struct pod_power_config cfg;
	struct pod_power_inputs in;
	int rc;

	if (pod_wdt_init() != 0) {
		LOG_ERR("watchdog");
	}
	(void)pod_led_init();
	rc = pod_crypto_init();
	if (rc == 0) {
		rc = pod_crypto_selftest();
	}
	if (rc != 0) {
		fail_forever(rc > 0 ? rc : POD_SELFTEST_CCM);
	}
	if (pod_counters_init() != 0) {
		LOG_ERR("persistent counters: the pod will not transmit");
	}
	if (pod_power_hw_init() != 0) {
		LOG_WRN("charger not configured");
	}
	(void)pod_hall_init();
	(void)pod_time_base_init();
	if (pod_sensors_init() != 0) {
		LOG_WRN("sensors incomplete");
	}
	if (pod_log_init() != 0) {
		LOG_WRN("NAND not found");
	}
	if (pod_gnss_init() != 0) {
		LOG_WRN("GNSS boot sequence incomplete");
	}
	if (pod_lora_init() != 0) {
		LOG_WRN("LoRa not ready");
	}

	pod_power_config_defaults(&cfg);
	in = read_inputs();
	pod_power_init(&machine, &cfg, &in);
	LOG_INF("pod up, state %d", machine.state);

	for (;;) {
		struct pod_power_result r;
		struct pod_pps_anchor anchor;

		in = read_inputs();
		r = pod_power_step(&machine, &in);
		execute(&r, in.in_vest);
		if (pod_time_base_poll_pps(&anchor)) {
			/* TODO(B-904): pair with the GNSS second of the epoch → `time_anchor` record. */
			LOG_DBG("PPS at tick %llu + %u ns", (unsigned long long)anchor.tick,
				anchor.sub_tick_ns);
		}
		pod_led_show(led_for(r.state, in.vbus, in.battery_pct), 0);
		pod_led_update(in.now_ms, pod_power_vsys_mv());
		pod_wdt_feed();
		k_msleep(CONFIG_POD_MAIN_LOOP_MS);
	}
	return 0;
}
