/*
 * Power state machine against the table and precedence of pod-v0.md, plus
 * the BQ25180 register plan and MAX17048 conversions.
 */
#include <string.h>

#include "pod/power.h"
#include "test.h"

static struct pod_power_config cfg(void)
{
	struct pod_power_config c;

	pod_power_config_defaults(&c);
	c.out_of_vest_grace_ms = 60000;
	c.long_still_ms = 600000;
	c.standby_to_off_ms = 1800000;
	c.min_vest_motion_ms = 30000;
	c.critical_battery_pct = 5;
	return c;
}

static struct pod_power_inputs in(uint32_t t, bool vest, bool moving)
{
	struct pod_power_inputs i;

	memset(&i, 0, sizeof(i));
	i.now_ms = t;
	i.in_vest = vest;
	i.moving = moving;
	i.battery_pct = 80;
	i.nand_idle = true;
	return i;
}

/* Boots out of the dock and opens a session at t = 1000 (vest on and moving). */
static void open_session(struct pod_power_machine *m)
{
	struct pod_power_config c = cfg();
	struct pod_power_inputs i = in(0, false, false);
	struct pod_power_result r;

	pod_power_init(m, &c, &i);
	CHECK_EQ(m->state, POD_POWER_STANDBY);
	i = in(1000, true, true);
	r = pod_power_step(m, &i);
	CHECK_EQ(r.state, POD_POWER_STANDBY); /* not long enough yet */
	i = in(30999, true, true);
	r = pod_power_step(m, &i);
	CHECK_EQ(r.state, POD_POWER_STANDBY);
	i = in(31000, true, true);
	r = pod_power_step(m, &i);
	CHECK_EQ(r.state, POD_POWER_ACTIVE);
	CHECK(r.actions & POD_PWR_ACT_OPEN_SESSION);
	CHECK(r.actions & POD_PWR_ACT_GNSS_ON);
	CHECK(r.actions & POD_PWR_ACT_LORA_ON);
	/* The session starts when the vest went on, not when it was confirmed. */
	CHECK_EQ(r.session_time_ms, 1000);
}

static void opens_after_vest_and_motion(void)
{
	struct pod_power_machine m;

	open_session(&m);
}

static void motion_without_vest_never_opens(void)
{
	struct pod_power_machine m;
	struct pod_power_config c = cfg();
	struct pod_power_inputs i = in(0, false, true);
	struct pod_power_result r;

	pod_power_init(&m, &c, &i);
	for (uint32_t t = 0; t < 10u * 60u * 1000u; t += 1000) {
		i = in(t, false, true); /* shaken in a bag */
		r = pod_power_step(&m, &i);
		CHECK_EQ(r.state, POD_POWER_STANDBY);
	}
}

static void out_of_vest_closes_at_exit_time(void)
{
	struct pod_power_machine m;
	struct pod_power_inputs i;
	struct pod_power_result r;

	open_session(&m);
	i = in(100000, false, true);
	r = pod_power_step(&m, &i);
	CHECK_EQ(r.state, POD_POWER_ACTIVE); /* grace */
	i = in(159999, false, true);
	r = pod_power_step(&m, &i);
	CHECK_EQ(r.state, POD_POWER_ACTIVE);
	i = in(160000, false, true);
	r = pod_power_step(&m, &i);
	CHECK_EQ(r.state, POD_POWER_STANDBY);
	CHECK(r.actions & POD_PWR_ACT_CLOSE_SESSION);
	CHECK(r.actions & POD_PWR_ACT_GNSS_BACKUP);
	CHECK(r.actions & POD_PWR_ACT_LORA_OFF);
	CHECK_EQ(r.close_reason, POD_CLOSE_OUT_OF_VEST);
	CHECK_EQ(r.session_time_ms, 100000);
}

static void back_in_vest_within_grace_keeps_recording(void)
{
	struct pod_power_machine m;
	struct pod_power_inputs i;
	struct pod_power_result r;

	open_session(&m);
	i = in(100000, false, true);
	pod_power_step(&m, &i);
	i = in(130000, true, true);
	pod_power_step(&m, &i);
	i = in(200000, true, true);
	r = pod_power_step(&m, &i);
	CHECK_EQ(r.state, POD_POWER_ACTIVE);
	CHECK(!(r.actions & POD_PWR_ACT_CLOSE_SESSION));
}

static void long_stillness_in_vest_closes_at_start_of_stillness(void)
{
	struct pod_power_machine m;
	struct pod_power_inputs i;
	struct pod_power_result r;

	open_session(&m);
	i = in(50000, true, false);
	r = pod_power_step(&m, &i);
	CHECK_EQ(r.state, POD_POWER_ACTIVE); /* a player on the bench keeps recording */
	i = in(649999, true, false);
	r = pod_power_step(&m, &i);
	CHECK_EQ(r.state, POD_POWER_ACTIVE);
	i = in(650000, true, false);
	r = pod_power_step(&m, &i);
	CHECK_EQ(r.state, POD_POWER_STANDBY);
	CHECK_EQ(r.close_reason, POD_CLOSE_LONG_STILL);
	CHECK_EQ(r.session_time_ms, 50000);
}

static void vbus_wins_over_everything(void)
{
	struct pod_power_machine m;
	struct pod_power_inputs i;
	struct pod_power_result r;

	open_session(&m);
	i = in(40000, true, true);
	i.vbus = true;
	i.app_close = true;
	r = pod_power_step(&m, &i);
	CHECK_EQ(r.state, POD_POWER_DOCKED);
	CHECK_EQ(r.close_reason, POD_CLOSE_DOCKED);
	CHECK_EQ(r.session_time_ms, 40000);
	/* Out of the dock → standby; in the vest again → active after the minimum. */
	i = in(50000, false, false);
	r = pod_power_step(&m, &i);
	CHECK_EQ(r.state, POD_POWER_STANDBY);
}

static void app_close_does_not_reopen_at_once(void)
{
	struct pod_power_machine m;
	struct pod_power_inputs i;
	struct pod_power_result r;

	open_session(&m);
	i = in(40000, true, true);
	i.app_close = true;
	r = pod_power_step(&m, &i);
	CHECK_EQ(r.state, POD_POWER_STANDBY);
	CHECK_EQ(r.close_reason, POD_CLOSE_APP);
	i = in(41000, true, true);
	r = pod_power_step(&m, &i);
	CHECK_EQ(r.state, POD_POWER_STANDBY);
	i = in(70999, true, true);
	r = pod_power_step(&m, &i);
	CHECK_EQ(r.state, POD_POWER_STANDBY);
	i = in(71000, true, true);
	r = pod_power_step(&m, &i);
	CHECK_EQ(r.state, POD_POWER_ACTIVE);
	CHECK_EQ(r.session_time_ms, 41000);
}

static void standby_goes_to_system_off(void)
{
	struct pod_power_machine m;
	struct pod_power_config c = cfg();
	struct pod_power_inputs i = in(0, false, false);
	struct pod_power_result r;

	pod_power_init(&m, &c, &i);
	i = in(1799999, false, false);
	r = pod_power_step(&m, &i);
	CHECK_EQ(r.state, POD_POWER_STANDBY);
	i = in(1800000, false, false);
	r = pod_power_step(&m, &i);
	CHECK_EQ(r.state, POD_POWER_SYSTEM_OFF);
	CHECK(r.actions & POD_PWR_ACT_SYSTEM_OFF);
	i = in(1900000, true, true);
	i.vbus = true;
	r = pod_power_step(&m, &i);
	CHECK_EQ(r.state, POD_POWER_SYSTEM_OFF); /* terminal: it wakes through a reset */
}

static void critical_battery_waits_for_nand_then_ships(void)
{
	struct pod_power_machine m;
	struct pod_power_inputs i;
	struct pod_power_result r;

	open_session(&m);
	i = in(40000, true, true);
	i.battery_pct = 4;
	i.nand_idle = false;
	r = pod_power_step(&m, &i);
	CHECK_EQ(r.state, POD_POWER_ACTIVE);
	CHECK(r.actions & POD_PWR_ACT_WAIT_NAND);
	CHECK(r.actions & POD_PWR_ACT_CLOSE_SESSION);
	CHECK_EQ(r.close_reason, POD_CLOSE_BATTERY_CRITICAL);
	i = in(40100, true, true);
	i.battery_pct = 4;
	r = pod_power_step(&m, &i);
	CHECK_EQ(r.state, POD_POWER_SHIP);
	CHECK(r.actions & POD_PWR_ACT_SHIP_MODE);
	/* Unknown battery never counts as critical. */
	open_session(&m);
	i = in(40000, true, true);
	i.battery_pct = 127;
	r = pod_power_step(&m, &i);
	CHECK_EQ(r.state, POD_POWER_ACTIVE);
}

static void wake_plan(void)
{
	struct pod_power_config c = cfg();
	struct pod_wake_plan p = pod_power_wake_plan(&c, true);

	CHECK(p.hall_sense_high); /* in the vest the output is low: wake when it goes high */
	CHECK(p.imu_motion);
	CHECK(p.charger_int);
	p = pod_power_wake_plan(&c, false);
	CHECK(!p.hall_sense_high);
	CHECK(!p.imu_motion); /* a pod in a bag does not wake on every bump */
	c.off_vest_wake_hall_only = false;
	p = pod_power_wake_plan(&c, false);
	CHECK(p.imu_motion);
}

static void bq25180_plan(void)
{
	struct pod_reg_update u[4];
	struct pod_reg_update ship;
	size_t n = pod_bq25180_boot_plan(300, u, 4);

	CHECK_EQ(pod_bq25180_ichg_code(10), 5);
	CHECK_EQ(pod_bq25180_ichg_code(35), 30);
	CHECK_EQ(pod_bq25180_ichg_code(40), 31);
	CHECK_EQ(pod_bq25180_ichg_code(300), 57);
	CHECK_EQ(pod_bq25180_ichg_code(350), 62);
	CHECK_EQ(pod_bq25180_ichg_code(2000), 127);
	CHECK_EQ(n, 3);
	CHECK_EQ(u[0].reg, POD_BQ25180_REG_SHIP_RST);
	CHECK_EQ(u[0].mask, POD_BQ25180_SHIP_RST_EN_PUSH);
	CHECK_EQ(u[0].value, 0); /* EN_PUSH cleared */
	CHECK_EQ(u[1].reg, POD_BQ25180_REG_SYS_REG);
	CHECK_EQ(u[1].value, POD_BQ25180_SYS_REG_WATCHDOG_15S);
	CHECK_EQ(u[2].reg, POD_BQ25180_REG_ICHG_CTRL);
	CHECK_EQ(u[2].value, 57);
	CHECK_EQ(pod_bq25180_boot_plan(300, u, 2), 0);
	ship = pod_bq25180_ship_update();
	CHECK_EQ(ship.reg, POD_BQ25180_REG_SHIP_RST);
	CHECK_EQ(ship.value, 0x20);
	CHECK_EQ(ship.mask, 0x60);
}

static void max17048(void)
{
	CHECK_EQ(pod_max17048_vcell_mv(0xD000), 4160);
	CHECK_EQ(pod_max17048_soc_pct(0x5780), 87);
	CHECK_EQ(pod_max17048_soc_pct(0x6500), 100);
}

void run_power_tests(void)
{
	RUN(opens_after_vest_and_motion);
	RUN(motion_without_vest_never_opens);
	RUN(out_of_vest_closes_at_exit_time);
	RUN(back_in_vest_within_grace_keeps_recording);
	RUN(long_stillness_in_vest_closes_at_start_of_stillness);
	RUN(vbus_wins_over_everything);
	RUN(app_close_does_not_reopen_at_once);
	RUN(standby_goes_to_system_off);
	RUN(critical_battery_waits_for_nand_then_ships);
	RUN(wake_plan);
	RUN(bq25180_plan);
	RUN(max17048);
}
