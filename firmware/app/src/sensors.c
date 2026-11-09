/*
 * IMU (LSM6DSV32X on SPIM1) and barometer (BMP581 on TWIM0) through the
 * Zephyr sensor drivers.
 *
 * Stub status (B-904): presence check for the boot self-test and a simple
 * motion estimate from one accelerometer sample. TODO: FIFO batches into
 * `imu_batch` records (both channels, sensor timestamps, `sensor_sync` at each
 * PPS), the ±320 g channel and impact bursts, the latched wake-up interrupt on
 * INT1 for System OFF (high-g channel off first, AN6119), the activity /
 * inactivity function as the `moving` input, and 25–50 Hz barometer batches.
 */
#include <zephyr/device.h>
#include <zephyr/drivers/sensor.h>
#include <zephyr/kernel.h>
#include <zephyr/logging/log.h>

#include "pod_app.h"

LOG_MODULE_REGISTER(pod_sensors, CONFIG_POD_LOG_LEVEL);

#if defined(CONFIG_POD_SENSORS)
static const struct device *const imu = DEVICE_DT_GET_OR_NULL(DT_NODELABEL(imu));
static const struct device *const baro = DEVICE_DT_GET_OR_NULL(DT_NODELABEL(baro));
#endif

/* |a| − 1 g above this (mm/s²) counts as movement in the stub. */
#define MOTION_THRESHOLD_MM_S2 1500

int pod_sensors_init(void)
{
#if defined(CONFIG_POD_SENSORS)
	int missing = 0;

	if (imu == NULL || !device_is_ready(imu)) {
		LOG_WRN("IMU not ready");
		missing++;
	}
	if (baro == NULL || !device_is_ready(baro)) {
		LOG_WRN("barometer not ready");
	}
	return missing == 0 ? 0 : -ENODEV;
#else
	return -ENOTSUP;
#endif
}

bool pod_sensors_moving(void)
{
#if defined(CONFIG_POD_SENSORS)
	struct sensor_value acc[3];
	int64_t sq = 0;

	if (imu == NULL || !device_is_ready(imu) || sensor_sample_fetch(imu) != 0 ||
	    sensor_channel_get(imu, SENSOR_CHAN_ACCEL_XYZ, acc) != 0) {
		return false;
	}
	for (int i = 0; i < 3; i++) {
		int64_t mm = sensor_value_to_milli(&acc[i]);

		sq += mm * mm;
	}
	/* Compare |a|² with (1 g ± threshold)² in (mm/s²)². */
	{
		const int64_t g = 9807;
		const int64_t lo = g - MOTION_THRESHOLD_MM_S2;
		const int64_t hi = g + MOTION_THRESHOLD_MM_S2;

		return sq < lo * lo || sq > hi * hi;
	}
#else
	return false;
#endif
}

int pod_sensors_low_power(bool low)
{
	/* TODO(B-904): IMU low-power accelerometer with the wake-up interrupt, baro standby. */
	ARG_UNUSED(low);
	return 0;
}
