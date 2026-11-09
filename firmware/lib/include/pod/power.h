/*
 * Power states of the pod (docs/hardware/pod-v0.md, "Estados de energía y
 * consumo") as a pure state machine, plus the register plan of the BQ25180
 * charger and the conversions of the MAX17048 fuel gauge. The glue
 * (app/src/power.c) feeds it the inputs and executes the actions.
 *
 * Every time comes from the club configuration (never fixed in code): the
 * defaults below are placeholders until the club sets them.
 */
#ifndef POD_POWER_H_
#define POD_POWER_H_

#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>

enum pod_power_state {
	/** VBUS present: charging, USB download, DFU. */
	POD_POWER_DOCKED = 0,
	/** In the vest with motion (or inside the grace time out of it): recording. */
	POD_POWER_ACTIVE,
	/** No session: BLE slow, IMU wake-up armed, GNSS in backup, E22 off. */
	POD_POWER_STANDBY,
	/** nRF System OFF: only the wake sources stay armed. Terminal (wakes by reset). */
	POD_POWER_SYSTEM_OFF,
	/** BQ25180 ship / shutdown mode: SYS cut, wakes only with VBUS. Terminal. */
	POD_POWER_SHIP,
};

/** Why a session closed (mirrors `recording_stop` reasons of the log). */
enum pod_session_close_reason {
	POD_CLOSE_NONE = 0,
	POD_CLOSE_DOCKED,
	POD_CLOSE_APP,
	POD_CLOSE_OUT_OF_VEST,
	POD_CLOSE_LONG_STILL,
	POD_CLOSE_BATTERY_CRITICAL,
	POD_CLOSE_SHIP_COMMAND,
};

/** Club configuration (defaults in `pod_power_config_defaults`, placeholders). */
struct pod_power_config {
	/** Out of the vest while active: keep everything on for this long. */
	uint32_t out_of_vest_grace_ms;
	/** Still inside the vest for this long closes the session. */
	uint32_t long_still_ms;
	/** Standby without motion for this long goes to System OFF. */
	uint32_t standby_to_off_ms;
	/** In the vest and moving for at least this long before a session opens. */
	uint32_t min_vest_motion_ms;
	/** Battery % below which the pod goes to ship mode to protect the cell. */
	uint8_t critical_battery_pct;
	/** Out of the vest, System OFF wakes only by Hall or VBUS (club option, on). */
	bool off_vest_wake_hall_only;
};

void pod_power_config_defaults(struct pod_power_config *cfg);

/** Snapshot of the inputs at `now_ms`. */
struct pod_power_inputs {
	uint32_t now_ms;
	bool vbus;
	/** Hall: pod inside the vest pocket. */
	bool in_vest;
	/** IMU activity (wake-up / activity function). */
	bool moving;
	/** 0..100, 127 unknown. */
	uint8_t battery_pct;
	/** Staff closed the session from the app (one-shot). */
	bool app_close;
	/** App asked for ship mode (long storage, one-shot). */
	bool ship_request;
	/** NAND idle (no program / erase in progress) and the segment file closed. */
	bool nand_idle;
};

/** What the glue has to do after a step (bitmask). */
#define POD_PWR_ACT_GNSS_ON (1u << 0)
#define POD_PWR_ACT_GNSS_BACKUP (1u << 1)
#define POD_PWR_ACT_LORA_ON (1u << 2)
#define POD_PWR_ACT_LORA_OFF (1u << 3)
#define POD_PWR_ACT_OPEN_SESSION (1u << 4)
#define POD_PWR_ACT_CLOSE_SESSION (1u << 5)
#define POD_PWR_ACT_IMU_LOW_POWER (1u << 6)
#define POD_PWR_ACT_IMU_SESSION_RATE (1u << 7)
#define POD_PWR_ACT_SYSTEM_OFF (1u << 8)
#define POD_PWR_ACT_SHIP_MODE (1u << 9)
/** Ship mode wanted but the NAND is busy: close the file and step again. */
#define POD_PWR_ACT_WAIT_NAND (1u << 10)

struct pod_power_machine {
	struct pod_power_config cfg;
	enum pod_power_state state;
	bool session_open;
	/** Start of the current "in vest and moving" stretch, valid if `vest_motion`. */
	bool vest_motion;
	uint32_t vest_motion_since_ms;
	bool out_of_vest;
	uint32_t out_of_vest_since_ms;
	bool still;
	uint32_t still_since_ms;
	uint32_t standby_since_ms;
	bool ship_pending;
	enum pod_session_close_reason pending_close_reason;
};

struct pod_power_result {
	enum pod_power_state state;
	uint32_t actions;
	/** Session open / close time: the event time, not the confirmation time. */
	uint32_t session_time_ms;
	enum pod_session_close_reason close_reason;
};

/** Starts after a reset (boot or wake from System OFF) in `initial`. */
void pod_power_init(struct pod_power_machine *m, const struct pod_power_config *cfg,
		    const struct pod_power_inputs *in);

struct pod_power_result pod_power_step(struct pod_power_machine *m,
				       const struct pod_power_inputs *in);

/** Wake sources to arm before System OFF (the Hall SENSE on the level opposite to now). */
struct pod_wake_plan {
	/** SENSE on HALL_INT: true = wake on high (pod now in the vest, output low). */
	bool hall_sense_high;
	/** Arm the IMU INT1 motion wake-up. */
	bool imu_motion;
	/** CHG_INT (BQ25180 /INT, active low) and VBUS detection are always armed. */
	bool charger_int;
};

struct pod_wake_plan pod_power_wake_plan(const struct pod_power_config *cfg, bool in_vest);

/** Physical levels of the wake pins, read right before System OFF. */
struct pod_wake_levels {
	bool hall_high;
	bool imu_int1_high;
	bool chg_int_low;
};

/**
 * Wake-loop guard (pod-v0.md, "Regla antes de System OFF"): true only when no
 * armed SENSE source is already at its wake level. Otherwise the nRF would
 * wake at once and loop; the pod stays in standby and tries again later.
 */
bool pod_wake_plan_safe(const struct pod_wake_plan *plan, const struct pod_wake_levels *levels);

/* ---------------------------------------------------------------------- */
/* BQ25180 (TI SLUSE99C; register map as in Zephyr's charger_bq2518x.c). */

#define POD_BQ25180_I2C_ADDR 0x6A
#define POD_BQ25180_REG_STAT0 0x00
#define POD_BQ25180_REG_ICHG_CTRL 0x04
#define POD_BQ25180_REG_SHIP_RST 0x09
#define POD_BQ25180_REG_SYS_REG 0x0A
/** SHIP_RST[0] EN_PUSH: 1 by default; cleared at boot (a hot NTC reads as a long press). */
#define POD_BQ25180_SHIP_RST_EN_PUSH (1u << 0)
/** SHIP_RST[6:5] EN_RST_SHIP = 01: shutdown, wake on adapter only (~15 nA). */
#define POD_BQ25180_SHIP_RST_SHUTDOWN_ADAPTER 0x20u
#define POD_BQ25180_SHIP_RST_EN_RST_SHIP_MASK 0x60u
/** SYS_REG[1] WATCHDOG_15S_ENABLE: hardware reset if no I2C within 15 s of VIN. */
#define POD_BQ25180_SYS_REG_WATCHDOG_15S (1u << 1)
#define POD_BQ25180_ICHG_MASK 0x7Fu

struct pod_reg_update {
	uint8_t reg;
	uint8_t mask;
	uint8_t value;
};

/** STAT0[0] VIN_PGOOD_STAT. */
#define POD_BQ25180_STAT0_VIN_PGOOD (1u << 0)
/**
 * Service of the BQ25180 watchdogs:
 *
 * - The I2C watchdog of host mode (IC_CTRL WATCHDOG_SEL; the datasheet gives
 *   160 s in the register table and "50 s" for the normal watchdog in the text:
 *   not verified, the shorter one is assumed) resets ICHG, EN_PUSH and
 *   WATCHDOG_15S_ENABLE when the host goes quiet: STAT0 is read at least every
 *   `POD_BQ25180_SERVICE_PERIOD_MS`.
 * - The 15 s watchdog counts from VIN_PGOOD, which can come after the nRF sees
 *   VBUS: after a VBUS edge STAT0 is polled every `POD_BQ25180_FAST_PERIOD_MS`
 *   for up to `POD_BQ25180_FAST_WINDOW_MS`, until PGOOD reads 1 and the plan is
 *   written.
 */
#define POD_BQ25180_SERVICE_PERIOD_MS 30000u
#define POD_BQ25180_FAST_PERIOD_MS 1000u
#define POD_BQ25180_FAST_WINDOW_MS 20000u

struct pod_bq25180_watch {
	bool have_stat0;
	uint8_t last_stat0;
	uint32_t last_service_ms;
	/** Fast polling after a VBUS edge, until PGOOD and the plan, or the window ends. */
	bool fast;
	uint32_t fast_since_ms;
};

/** The nRF saw VBUS appear: start the fast polling window. */
void pod_bq25180_vbus_edge(struct pod_bq25180_watch *w, uint32_t now_ms);

/** True when STAT0 has to be read now. */
bool pod_bq25180_service_due(const struct pod_bq25180_watch *w, uint32_t now_ms);

/**
 * Records a service read (STAT0 and SYS_REG) and tells whether the boot plan
 * has to be written again: VIN_PGOOD changed, SYS_REG lost WATCHDOG_15S_ENABLE
 * (the registers went back to their defaults), or PGOOD reads 1 during the fast
 * window (the 15 s watchdog has just started: answer it).
 */
bool pod_bq25180_after_read(struct pod_bq25180_watch *w, uint32_t now_ms, uint8_t stat0,
			    uint8_t sys_reg);

/** ICHG code for a charge current (5–35 mA in 1 mA steps, then 10 mA steps up to 1 A). */
uint8_t pod_bq25180_ichg_code(uint16_t charge_ma);

/**
 * Register updates at every boot: EN_PUSH = 0, 15 s watchdog on, charge current
 * (300–350 mA, never the 10 mA default). Returns how many were written to `out`.
 */
size_t pod_bq25180_boot_plan(uint16_t charge_ma, struct pod_reg_update *out, size_t cap);

/** Update that enters shutdown mode (wake on adapter only). */
struct pod_reg_update pod_bq25180_ship_update(void);

/* ---------------------------------------------------------------------- */
/* MAX17048 (address 0x36, not verified against the Maxim sheet). */

#define POD_MAX17048_I2C_ADDR 0x36
#define POD_MAX17048_REG_VCELL 0x02
#define POD_MAX17048_REG_SOC 0x04
#define POD_MAX17048_REG_MODE 0x06
#define POD_MAX17048_REG_CONFIG 0x0C

/** VCELL register (big-endian u16) to mV: 78.125 µV per LSB. */
uint16_t pod_max17048_vcell_mv(uint16_t reg);

/** SOC register to %, rounded down and clamped to 100 (MSB = %, LSB = 1/256 %). */
uint8_t pod_max17048_soc_pct(uint16_t reg);

#endif /* POD_POWER_H_ */
