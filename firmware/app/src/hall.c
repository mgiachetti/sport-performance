/*
 * Vest detection: DRV5032FA (omnipolar, push-pull, 20 Hz; the FB at 5 Hz is the
 * approved alternate) on HALL_INT, low with the pocket magnet. The System OFF
 * SENSE is armed on the level opposite to the current one (app/src/power.c), so
 * it is never active when the pod sleeps.
 */
#include <zephyr/drivers/gpio.h>

#include "pod_app.h"

static const struct gpio_dt_spec hall = GPIO_DT_SPEC_GET(DT_PATH(zephyr_user), hall_gpios);

int pod_hall_init(void)
{
	if (!gpio_is_ready_dt(&hall)) {
		return -ENODEV;
	}
	/* No pull: push-pull output through the series resistor (pod-v0.md, NFC pads). */
	return gpio_pin_configure_dt(&hall, GPIO_INPUT);
}

bool pod_hall_in_vest(void)
{
	/* Active low in the devicetree: 1 = magnet present = in the vest. */
	return gpio_pin_get_dt(&hall) == 1;
}
