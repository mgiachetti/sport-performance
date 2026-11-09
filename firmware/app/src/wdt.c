/*
 * nRF52840 watchdog: mandatory (pod-v0.md, "Watchdog"). It keeps running while
 * the CPU sleeps and is paused only under the debugger. The BQ25180 15 s
 * watchdog is the second, hardware-level reset (app/src/power.c).
 */
#include <zephyr/device.h>
#include <zephyr/drivers/watchdog.h>
#include <zephyr/logging/log.h>

#include "pod_app.h"

LOG_MODULE_REGISTER(pod_wdt, CONFIG_POD_LOG_LEVEL);

static const struct device *const wdt = DEVICE_DT_GET(DT_ALIAS(watchdog0));
static int channel = -1;

int pod_wdt_init(void)
{
	struct wdt_timeout_cfg cfg = {
		.window = {.min = 0, .max = CONFIG_POD_WDT_TIMEOUT_MS},
		.callback = NULL,
		.flags = WDT_FLAG_RESET_SOC,
	};
	int rc;

	if (!device_is_ready(wdt)) {
		return -ENODEV;
	}
	channel = wdt_install_timeout(wdt, &cfg);
	if (channel < 0) {
		return channel;
	}
	rc = wdt_setup(wdt, WDT_OPT_PAUSE_HALTED_BY_DBG);
	if (rc != 0) {
		LOG_ERR("wdt setup: %d", rc);
	}
	return rc;
}

void pod_wdt_feed(void)
{
	if (channel >= 0) {
		(void)wdt_feed(wdt, channel);
	}
}
