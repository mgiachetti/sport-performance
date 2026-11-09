/*
 * Power hardware: BQ25180 register plan at every boot (EN_PUSH = 0, 15 s
 * watchdog, charge current), MAX17048 readings, VBUS detection, System OFF
 * with its wake sources and BQ25180 shutdown ("modo envío"). The decisions are
 * in firmware/lib/src/power.c (host-tested).
 */
#include <zephyr/drivers/gpio.h>
#include <zephyr/drivers/i2c.h>
#include <zephyr/kernel.h>
#include <zephyr/logging/log.h>
#include <zephyr/sys/poweroff.h>

#include <hal/nrf_power.h>

#include "pod_app.h"

LOG_MODULE_REGISTER(pod_power, CONFIG_POD_LOG_LEVEL);

#define CHARGER_NODE DT_NODELABEL(charger)
#define GAUGE_NODE DT_NODELABEL(fuel_gauge)
#define USER_NODE DT_PATH(zephyr_user)

#if DT_NODE_HAS_STATUS(CHARGER_NODE, okay)
static const struct i2c_dt_spec charger = I2C_DT_SPEC_GET(CHARGER_NODE);
#define HAVE_CHARGER 1
#else
#define HAVE_CHARGER 0
#endif

#if DT_NODE_HAS_STATUS(GAUGE_NODE, okay)
static const struct i2c_dt_spec gauge = I2C_DT_SPEC_GET(GAUGE_NODE);
#define HAVE_GAUGE 1
#else
#define HAVE_GAUGE 0
#endif

static const struct gpio_dt_spec chg_int = GPIO_DT_SPEC_GET_OR(USER_NODE, chg_int_gpios, {0});
static const struct gpio_dt_spec hall = GPIO_DT_SPEC_GET(USER_NODE, hall_gpios);
#if DT_NODE_HAS_PROP(DT_NODELABEL(imu), int1_gpios)
static const struct gpio_dt_spec imu_int1 = GPIO_DT_SPEC_GET(DT_NODELABEL(imu), int1_gpios);
#else
static const struct gpio_dt_spec imu_int1 = {0};
#endif

#if HAVE_CHARGER
static struct pod_bq25180_watch watch;

static int apply_plan(void)
{
	struct pod_reg_update plan[4];
	size_t n = pod_bq25180_boot_plan(CONFIG_POD_CHARGE_CURRENT_MA, plan, ARRAY_SIZE(plan));

	for (size_t i = 0; i < n; i++) {
		int rc = i2c_reg_update_byte_dt(&charger, plan[i].reg, plan[i].mask, plan[i].value);

		if (rc != 0) {
			LOG_ERR("BQ25180 reg 0x%02x: %d", plan[i].reg, rc);
			return rc;
		}
	}
	return 0;
}
#endif

int pod_power_hw_init(void)
{
	if (chg_int.port != NULL) {
		(void)gpio_pin_configure_dt(&chg_int, GPIO_INPUT);
	}
#if HAVE_CHARGER
	if (!i2c_is_ready_dt(&charger)) {
		return -ENODEV;
	}
	return apply_plan();
#else
	return 0;
#endif
}

void pod_power_service(uint32_t now_ms)
{
#if HAVE_CHARGER
	uint8_t stat0, sys_reg;

	/*
	 * Every I2C transaction restarts the BQ25180 watchdogs: the 160 s host-mode
	 * one (that would reset ICHG, EN_PUSH and WATCHDOG_15S_ENABLE) and the 15 s
	 * one after each VIN insertion.
	 */
	static bool last_vbus;
	bool vbus = pod_power_vbus();

	/* A dock insertion is serviced at once: the 15 s watchdog counts from VIN. */
	if (vbus == last_vbus && !pod_bq25180_service_due(&watch, now_ms)) {
		return;
	}
	last_vbus = vbus;
	if (i2c_reg_read_byte_dt(&charger, POD_BQ25180_REG_STAT0, &stat0) != 0 ||
	    i2c_reg_read_byte_dt(&charger, POD_BQ25180_REG_SYS_REG, &sys_reg) != 0) {
		LOG_WRN("BQ25180 not answering");
		return;
	}
	if (pod_bq25180_after_read(&watch, now_ms, stat0, sys_reg)) {
		LOG_INF("BQ25180 plan re-applied (STAT0 0x%02x)", stat0);
		(void)apply_plan();
	}
#else
	ARG_UNUSED(now_ms);
#endif
}

bool pod_power_vbus(void)
{
	return nrf_power_usbregstatus_vbusdet_get(NRF_POWER);
}

static int gauge_read(uint8_t reg, uint16_t *value)
{
#if HAVE_GAUGE
	uint8_t buf[2];
	int rc = i2c_burst_read_dt(&gauge, reg, buf, sizeof(buf));

	if (rc == 0) {
		*value = (uint16_t)((buf[0] << 8) | buf[1]);
	}
	return rc;
#else
	ARG_UNUSED(reg);
	ARG_UNUSED(value);
	return -ENODEV;
#endif
}

uint8_t pod_power_battery_pct(void)
{
	uint16_t soc;

	return gauge_read(POD_MAX17048_REG_SOC, &soc) == 0 ? pod_max17048_soc_pct(soc) : 127;
}

uint16_t pod_power_vsys_mv(void)
{
	uint16_t vcell;

	if (pod_power_vbus()) {
		return 4500; /* SYS_REG default on the dock (4,4–4,9 V) */
	}
	/* With a battery, SYS follows the cell. */
	return gauge_read(POD_MAX17048_REG_VCELL, &vcell) == 0 ? pod_max17048_vcell_mv(vcell)
							       : POD_LED_VREF_MV;
}

int pod_power_system_off(const struct pod_wake_plan *plan)
{
	struct pod_wake_levels levels = {
		.hall_high = gpio_pin_get_raw(hall.port, hall.pin) == 1,
		.imu_int1_high = imu_int1.port != NULL && gpio_pin_get_raw(imu_int1.port,
									   imu_int1.pin) == 1,
		.chg_int_low = chg_int.port != NULL && gpio_pin_get_raw(chg_int.port, chg_int.pin) == 0,
	};

	/*
	 * Rule before System OFF (pod-v0.md): no SENSE source may already be at its
	 * wake level, or the nRF wakes at once in a loop. TODO(B-904): read and
	 * clear the latched LSM6DSV320X wake-up first.
	 */
	if (!pod_wake_plan_safe(plan, &levels)) {
		LOG_WRN("wake source active: staying in standby");
		return -EBUSY;
	}
	/* Level SENSE on the nRF52840: the GPIO driver arms SENSE for level interrupts. */
	(void)gpio_pin_interrupt_configure_dt(&hall, plan->hall_sense_high ? GPIO_INT_LEVEL_INACTIVE
									   : GPIO_INT_LEVEL_ACTIVE);
	if (plan->imu_motion && imu_int1.port != NULL) {
		(void)gpio_pin_interrupt_configure_dt(&imu_int1, GPIO_INT_LEVEL_ACTIVE);
	}
	if (plan->charger_int && chg_int.port != NULL) {
		(void)gpio_pin_interrupt_configure_dt(&chg_int, GPIO_INT_LEVEL_ACTIVE);
	}
	LOG_INF("System OFF");
	sys_poweroff();
	return 0;
}

int pod_power_ship_mode(void)
{
#if HAVE_CHARGER
	struct pod_reg_update u = pod_bq25180_ship_update();

	/* TODO(B-904): MAX17048 to sleep first (about 0,5 µA instead of 23 µA). */
	return i2c_reg_update_byte_dt(&charger, u.reg, u.mask, u.value);
#else
	return -ENODEV;
#endif
}
