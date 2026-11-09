/*
 * Power state machine (see pod/power.h). Precedence of what closes a session,
 * highest first (pod-v0.md): VBUS > app close > out of the vest past the grace
 * time > long stillness inside the vest. The session ends at the time of the
 * event that closed it (leaving the vest, start of the stillness), not when
 * the timer that confirms it expires.
 */
#include <string.h>

#include "pod/power.h"

#define BATTERY_UNKNOWN 127u

void pod_power_config_defaults(struct pod_power_config *cfg)
{
	/*
	 * Placeholders: the real values are club configuration (pod-v0.md says the
	 * document fixes none). Chosen only so the machine is testable.
	 */
	cfg->out_of_vest_grace_ms = 60u * 1000u;
	cfg->long_still_ms = 20u * 60u * 1000u;
	cfg->standby_to_off_ms = 30u * 60u * 1000u;
	cfg->min_vest_motion_ms = 30u * 1000u;
	cfg->critical_battery_pct = 5;
	cfg->off_vest_wake_hall_only = true;
}

static void track(bool condition, bool *flag, uint32_t *since, uint32_t now)
{
	if (condition) {
		if (!*flag) {
			*flag = true;
			*since = now;
		}
	} else {
		*flag = false;
	}
}

static uint32_t elapsed(uint32_t now, uint32_t since)
{
	return now - since; /* modulo 2^32: fine for intervals below ~49 days */
}

void pod_power_init(struct pod_power_machine *m, const struct pod_power_config *cfg,
		    const struct pod_power_inputs *in)
{
	memset(m, 0, sizeof(*m));
	m->cfg = *cfg;
	m->state = in->vbus ? POD_POWER_DOCKED : POD_POWER_STANDBY;
	m->standby_since_ms = in->now_ms;
	track(in->in_vest && in->moving, &m->vest_motion, &m->vest_motion_since_ms, in->now_ms);
	track(!in->in_vest, &m->out_of_vest, &m->out_of_vest_since_ms, in->now_ms);
	track(!in->moving, &m->still, &m->still_since_ms, in->now_ms);
}

static void close_session(struct pod_power_machine *m, struct pod_power_result *r,
			  uint32_t at_ms, enum pod_session_close_reason reason)
{
	if (!m->session_open) {
		return;
	}
	m->session_open = false;
	r->actions |= POD_PWR_ACT_CLOSE_SESSION;
	r->session_time_ms = at_ms;
	r->close_reason = reason;
}

static void enter_standby(struct pod_power_machine *m, struct pod_power_result *r, uint32_t now)
{
	m->state = POD_POWER_STANDBY;
	m->standby_since_ms = now;
	r->actions |= POD_PWR_ACT_GNSS_BACKUP | POD_PWR_ACT_LORA_OFF | POD_PWR_ACT_IMU_LOW_POWER;
}

struct pod_power_result pod_power_step(struct pod_power_machine *m,
				       const struct pod_power_inputs *in)
{
	struct pod_power_result r = {.state = m->state};
	const uint32_t now = in->now_ms;
	bool battery_critical = in->battery_pct != BATTERY_UNKNOWN &&
				in->battery_pct < m->cfg.critical_battery_pct;

	if (m->state == POD_POWER_SYSTEM_OFF || m->state == POD_POWER_SHIP) {
		return r;
	}
	track(in->in_vest && in->moving, &m->vest_motion, &m->vest_motion_since_ms, now);
	track(!in->in_vest, &m->out_of_vest, &m->out_of_vest_since_ms, now);
	track(!in->moving, &m->still, &m->still_since_ms, now);

	/* 1. VBUS: the dock closes the session even with a magnet nearby. */
	if (in->vbus) {
		m->ship_pending = false;
		if (m->state != POD_POWER_DOCKED) {
			close_session(m, &r, now, POD_CLOSE_DOCKED);
			m->state = POD_POWER_DOCKED;
			r.actions |= POD_PWR_ACT_LORA_OFF | POD_PWR_ACT_GNSS_BACKUP;
		}
		r.state = m->state;
		return r;
	}
	if (m->state == POD_POWER_DOCKED) {
		enter_standby(m, &r, now);
		r.actions &= ~POD_PWR_ACT_GNSS_BACKUP; /* already in backup on the dock */
	}

	/* 2. Ship mode (app command or critical battery): never with the NAND busy. */
	if (in->ship_request || battery_critical || m->ship_pending) {
		if (!m->ship_pending) {
			m->pending_close_reason = in->ship_request ? POD_CLOSE_SHIP_COMMAND
								   : POD_CLOSE_BATTERY_CRITICAL;
		}
		close_session(m, &r, now, m->pending_close_reason);
		if (!in->nand_idle) {
			m->ship_pending = true;
			r.actions |= POD_PWR_ACT_WAIT_NAND | POD_PWR_ACT_LORA_OFF;
			r.state = m->state;
			return r;
		}
		m->ship_pending = false;
		m->state = POD_POWER_SHIP;
		r.actions |= POD_PWR_ACT_SHIP_MODE;
		r.state = m->state;
		return r;
	}

	if (m->state == POD_POWER_ACTIVE) {
		if (in->app_close) {
			close_session(m, &r, now, POD_CLOSE_APP);
			enter_standby(m, &r, now);
		} else if (m->out_of_vest &&
			   elapsed(now, m->out_of_vest_since_ms) >= m->cfg.out_of_vest_grace_ms) {
			close_session(m, &r, m->out_of_vest_since_ms, POD_CLOSE_OUT_OF_VEST);
			enter_standby(m, &r, now);
		} else if (!m->out_of_vest && m->still &&
			   elapsed(now, m->still_since_ms) >= m->cfg.long_still_ms) {
			close_session(m, &r, m->still_since_ms, POD_CLOSE_LONG_STILL);
			enter_standby(m, &r, now);
		}
		/*
		 * After an app close the pod stays in the vest and moving: it must not
		 * reopen at once. Require a new "in vest and moving" stretch.
		 */
		if (r.close_reason == POD_CLOSE_APP) {
			m->vest_motion = false;
			m->vest_motion_since_ms = now;
		}
		r.state = m->state;
		return r;
	}

	/* STANDBY */
	if (m->vest_motion && elapsed(now, m->vest_motion_since_ms) >= m->cfg.min_vest_motion_ms) {
		m->state = POD_POWER_ACTIVE;
		m->session_open = true;
		r.actions |= POD_PWR_ACT_OPEN_SESSION | POD_PWR_ACT_GNSS_ON | POD_PWR_ACT_LORA_ON |
			     POD_PWR_ACT_IMU_SESSION_RATE;
		/* Putting the vest on marks the start of the session. */
		r.session_time_ms = m->vest_motion_since_ms;
	} else if (m->still) {
		uint32_t since = elapsed(m->still_since_ms, m->standby_since_ms) < 0x80000000u
					 ? m->still_since_ms
					 : m->standby_since_ms;

		if (elapsed(now, since) >= m->cfg.standby_to_off_ms) {
			m->state = POD_POWER_SYSTEM_OFF;
			r.actions |= POD_PWR_ACT_SYSTEM_OFF;
		}
	}
	r.state = m->state;
	return r;
}

struct pod_wake_plan pod_power_wake_plan(const struct pod_power_config *cfg, bool in_vest)
{
	struct pod_wake_plan p;

	/* Hall output is low with the magnet: arm the opposite level so it is not active now. */
	p.hall_sense_high = in_vest;
	p.imu_motion = in_vest || !cfg->off_vest_wake_hall_only;
	p.charger_int = true;
	return p;
}

bool pod_wake_plan_safe(const struct pod_wake_plan *plan, const struct pod_wake_levels *levels)
{
	if (plan->hall_sense_high == levels->hall_high) {
		return false; /* the Hall SENSE would fire immediately */
	}
	if (plan->imu_motion && levels->imu_int1_high) {
		return false; /* motion interrupt still latched: read and clear it first */
	}
	if (plan->charger_int && levels->chg_int_low) {
		return false;
	}
	return true;
}

uint8_t pod_bq25180_ichg_code(uint16_t charge_ma)
{
	if (charge_ma < 5) {
		charge_ma = 5;
	}
	if (charge_ma > 1000) {
		charge_ma = 1000;
	}
	if (charge_ma <= 35) {
		return (uint8_t)(charge_ma - 5);
	}
	return (uint8_t)((charge_ma - 40) / 10 + 31);
}

size_t pod_bq25180_boot_plan(uint16_t charge_ma, struct pod_reg_update *out, size_t cap)
{
	const struct pod_reg_update plan[] = {
		{POD_BQ25180_REG_SHIP_RST, POD_BQ25180_SHIP_RST_EN_PUSH, 0},
		{POD_BQ25180_REG_SYS_REG, POD_BQ25180_SYS_REG_WATCHDOG_15S,
		 POD_BQ25180_SYS_REG_WATCHDOG_15S},
		{POD_BQ25180_REG_ICHG_CTRL, POD_BQ25180_ICHG_MASK, pod_bq25180_ichg_code(charge_ma)},
	};
	size_t n = sizeof(plan) / sizeof(plan[0]);

	if (cap < n) {
		return 0;
	}
	memcpy(out, plan, sizeof(plan));
	return n;
}

struct pod_reg_update pod_bq25180_ship_update(void)
{
	struct pod_reg_update u = {POD_BQ25180_REG_SHIP_RST, POD_BQ25180_SHIP_RST_EN_RST_SHIP_MASK,
				   POD_BQ25180_SHIP_RST_SHUTDOWN_ADAPTER};

	return u;
}

void pod_bq25180_vbus_edge(struct pod_bq25180_watch *w, uint32_t now_ms)
{
	w->fast = true;
	w->fast_since_ms = now_ms;
}

bool pod_bq25180_service_due(const struct pod_bq25180_watch *w, uint32_t now_ms)
{
	uint32_t period = w->fast ? POD_BQ25180_FAST_PERIOD_MS : POD_BQ25180_SERVICE_PERIOD_MS;

	return !w->have_stat0 || now_ms - w->last_service_ms >= period;
}

bool pod_bq25180_after_read(struct pod_bq25180_watch *w, uint32_t now_ms, uint8_t stat0,
			    uint8_t sys_reg)
{
	bool pgood = (stat0 & POD_BQ25180_STAT0_VIN_PGOOD) != 0;
	bool reapply = (sys_reg & POD_BQ25180_SYS_REG_WATCHDOG_15S) == 0 ||
		       (w->have_stat0 && ((w->last_stat0 ^ stat0) & POD_BQ25180_STAT0_VIN_PGOOD));

	if (w->fast) {
		if (pgood) {
			reapply = true; /* talk to it inside its 15 s from PGOOD */
			w->fast = false;
		} else if (now_ms - w->fast_since_ms >= POD_BQ25180_FAST_WINDOW_MS) {
			w->fast = false; /* VBUS without PGOOD (bad adapter): back to the slow period */
		}
	}
	w->have_stat0 = true;
	w->last_stat0 = stat0;
	w->last_service_ms = now_ms;
	return reapply;
}

uint16_t pod_max17048_vcell_mv(uint16_t reg)
{
	return (uint16_t)(((uint32_t)reg * 78125u) / 1000000u);
}

uint8_t pod_max17048_soc_pct(uint16_t reg)
{
	uint8_t pct = (uint8_t)(reg >> 8);

	return pct > 100 ? 100 : pct;
}
