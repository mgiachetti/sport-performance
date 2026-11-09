/*
 * Interfaces between the Zephyr glue modules of the pod firmware. The formats
 * and decisions live in the portable library (firmware/lib, host-tested);
 * these modules only move bytes to and from the hardware.
 */
#ifndef POD_APP_H_
#define POD_APP_H_

#include <stdbool.h>
#include <stdint.h>

#include "pod/errors.h"
#include "pod/gnss.h"
#include "pod/led.h"
#include "pod/log.h"
#include "pod/power.h"
#include "pod/radio.h"
#include "pod/time_base.h"

/* boot_counter.c: persistent counters in NVS (ADR 0106). */
int pod_counters_init(void);
/** Boot counter of this boot (incremented and saved before the first TX). */
uint32_t pod_counters_boot(void);
/** Saves a new boot counter (frame number wrap, `pod_next_link_counter`). */
int pod_counters_persist_boot(uint32_t boot_counter);
/** First page sequence of a new segment, above the NVS reservation. */
uint32_t pod_counters_next_page_seq(void);
uint32_t pod_counters_next_segment_id(void);

/* wdt.c: nRF WDT, mandatory. */
int pod_wdt_init(void);
void pod_wdt_feed(void);

/* led.c: PWM0, three channels. */
int pod_led_init(void);
void pod_led_show(enum pod_led_state state, uint8_t param);
void pod_led_update(uint32_t now_ms, uint16_t vsys_mv);

/* hall.c: vest detection and its System OFF SENSE. */
int pod_hall_init(void);
bool pod_hall_in_vest(void);

/* power.c: BQ25180, MAX17048, VBUS, System OFF and ship mode. */
int pod_power_hw_init(void);
bool pod_power_vbus(void);
/** 0..100, 127 unknown. */
uint8_t pod_power_battery_pct(void);
/** SYS estimate for the LED dimming (mV). */
uint16_t pod_power_vsys_mv(void);
/** Arms the wake sources of `plan` and enters System OFF (never returns). */
void pod_power_system_off(const struct pod_wake_plan *plan);
/** Enters BQ25180 shutdown mode (wakes only with VBUS). */
int pod_power_ship_mode(void);

/* time_base.c: RTC2 tick + PPS capture through GPIOTE → PPI → TIMER2. */
int pod_time_base_init(void);
/** 48-bit record tick (RTC on the LFXO since boot). */
uint64_t pod_tick_now(void);
/** True once per new PPS edge; fills the anchor. */
bool pod_time_base_poll_pps(struct pod_pps_anchor *anchor);

/* gnss_lc29h.c: UART, boot sequence, PVT and RTCM. */
int pod_gnss_init(void);
int pod_gnss_power(bool on);
/** Latest PVT (valid = false when none). */
void pod_gnss_latest(struct pod_gnss_pvt *pvt);
/** GNSS firmware string from $PQTMVERNO (for firmware_info). */
const char *pod_gnss_version(void);

/* log_nand.c: W25N on SPIM3 and the segment writer. */
int pod_log_init(void);
int pod_log_start_segment(void);
int pod_log_append(const struct pod_log_record *record);
int pod_log_close_segment(void);
bool pod_log_idle(void);
/** Raw W25N access (`ecc`: 0 ok, 1 corrected, 2 uncorrectable). */
int pod_nand_read_page(uint32_t page, uint8_t data[POD_LOG_PAGE_SIZE], uint8_t *ecc);
int pod_nand_erase_block(uint32_t block);

/* lora_link.c: SX1262 through the Zephyr LoRa API. */
int pod_lora_init(void);
int pod_lora_power(bool on);
/** Seals and sends one uplink (the slot request when `summary` is NULL). */
int pod_lora_send_uplink(const struct pod_uplink_counters *c,
			 const struct pod_live_summary *summary, bool with_position, uint8_t channel);

/* sensors.c: LSM6DSV320X and BMP581. */
int pod_sensors_init(void);
bool pod_sensors_moving(void);
int pod_sensors_low_power(bool low);

#endif /* POD_APP_H_ */
