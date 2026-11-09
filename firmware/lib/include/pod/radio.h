/*
 * LoRa frame format v1 of the pod (ADR 0106, packages/pod-protocol/README.md,
 * "Formato de la radio"). Mirrors uplink.ts, downlink.ts, nonce.ts, counters.ts
 * and the KDF of crypto.ts byte for byte; tests/host checks it against
 * packages/pod-protocol/fixtures/v1/vectors.json.
 */
#ifndef POD_RADIO_H_
#define POD_RADIO_H_

#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>

#define POD_PROTOCOL_VERSION 1

/* Message types (low nibble of byte 0). */
#define POD_MSG_LIVE_SUMMARY 0x1
#define POD_MSG_LIVE_SUMMARY_NO_POSITION 0x2
#define POD_MSG_SLOT_REQUEST 0x3
#define POD_MSG_BEACON 0x8
#define POD_MSG_CONFIG 0x9
#define POD_MSG_RTCM_FRAGMENT 0xA

#define POD_TYPE_BYTE(code) ((uint8_t)((POD_PROTOCOL_VERSION << 4) | (code)))

#define POD_LINK_DIRECTION_UPLINK 0x00
#define POD_LINK_DIRECTION_DOWNLINK 0x01

#define POD_CCM_TAG_LEN 4
#define POD_UPLINK_HEADER_LEN 10
#define POD_LIVE_PAYLOAD_LEN 37
#define POD_LIVE_PAYLOAD_NO_POSITION_LEN 29
#define POD_LIVE_PACKET_LEN (POD_UPLINK_HEADER_LEN + POD_LIVE_PAYLOAD_LEN + POD_CCM_TAG_LEN)
#define POD_LIVE_PACKET_NO_POSITION_LEN                                                        \
	(POD_UPLINK_HEADER_LEN + POD_LIVE_PAYLOAD_NO_POSITION_LEN + POD_CCM_TAG_LEN)
#define POD_SLOT_REQUEST_PACKET_LEN (POD_UPLINK_HEADER_LEN + POD_CCM_TAG_LEN)

#define POD_BEACON_HEADER_LEN 8
#define POD_BEACON_FIXED_BODY_LEN 9
#define POD_SLOT_GRANT_LEN 3
#define POD_MAX_GRANTS_PER_BEACON 9
#define POD_RTCM_HEADER_LEN 10
#define POD_MAX_LORA_PAYLOAD_LEN 255
#define POD_MAX_RTCM_FRAGMENT_BODY_LEN                                                         \
	(POD_MAX_LORA_PAYLOAD_LEN - POD_RTCM_HEADER_LEN - POD_CCM_TAG_LEN)

/* Sentinels "no value this second". */
#define POD_NO_POSITION_DM INT16_MIN
#define POD_NO_SPEED_CM_S 0xFFFFu
#define POD_NO_DISTANCE_DM 0xFFu
#define POD_BATTERY_UNKNOWN 0x7Fu

/* TDMA frame (ADR 0106). */
#define POD_FRAME_MS 2000u
#define POD_BEACON_WINDOW_MS 120u
#define POD_SLOT_MS 115u
#define POD_GUARD_MS 3u
#define POD_CHANNELS_PER_NETWORK 8u
#define POD_CONTENTION_SLOT 0u
#define POD_SLOTS_PER_CHANNEL 16u

/** GNSS fix quality (3 bits). 7 is reserved. Same table in the log (`gnss_pvt`). */
enum pod_fix_quality {
	POD_FIX_NO_FIX = 0,
	POD_FIX_DEAD_RECKONING = 1,
	POD_FIX_2D = 2,
	POD_FIX_3D = 3,
	POD_FIX_DGNSS = 4,
	POD_FIX_RTK_FLOAT = 5,
	POD_FIX_RTK_FIXED = 6,
};

/** One of the two per-second summaries of a 2 s frame. */
struct pod_live_second {
	/** cm/s, `POD_NO_SPEED_CM_S` = no value. */
	uint16_t vmax_cm_s;
	/** dm, `POD_NO_DISTANCE_DM` = no value. */
	uint8_t distance_dm;
	/** Position relative to the session origin (only in `live_summary`). */
	bool has_position;
	int16_t x_dm;
	int16_t y_dm;
};

/** Live summary (cumulative counters saturate, never wrap). */
struct pod_live_summary {
	/** 0..100 %, `POD_BATTERY_UNKNOWN` = unknown. */
	uint8_t battery_pct;
	bool vest_on;
	enum pod_fix_quality fix_quality;
	uint32_t session_distance_dm;     /* u24 */
	uint16_t speed_band_distance_m[4];
	uint16_t accelerations_n;
	uint16_t decelerations_n;
	uint32_t accel_load_centi_au;     /* u24, never called "PlayerLoad" */
	uint16_t impacts_n;
	struct pod_live_second seconds[2]; /* t-1, t */
	uint8_t config_version;
};

/** Everything the clear header and the link nonce need. */
struct pod_uplink_counters {
	uint16_t network_id;
	uint16_t pod_short_id;
	/** Key epoch (key id). */
	uint8_t key_id;
	/** Full 32-bit persistent boot counter (the header carries its 16 low bits). */
	uint32_t boot_counter;
	/** 2 s frames since boot. */
	uint16_t frame_number;
};

/** Link nonce: boot counter u32 ‖ frame u16 ‖ direction ‖ 6 zeros (13 B). */
void pod_link_nonce(uint32_t boot_counter, uint16_t frame_number, uint8_t direction,
		    uint8_t out[13]);

/** Beacon / downlink nonce: network u16 ‖ GNSS s u32 ‖ byte 0 ‖ fragment ‖ 5 zeros. */
void pod_downlink_nonce(uint16_t network_id, uint32_t gnss_time_s, uint8_t type_byte,
			uint8_t fragment_index, uint8_t out[13]);

/** Clear header (AAD) of an uplink frame, 10 B. */
int pod_uplink_header_encode(uint8_t type_code, const struct pod_uplink_counters *c,
			     uint8_t out[POD_UPLINK_HEADER_LEN]);

/**
 * Plaintext of the live summary: 37 B with positions, 29 B without.
 * Returns the length or a negative `pod_err`.
 */
int pod_live_payload_encode(const struct pod_live_summary *s, bool with_position, uint8_t *out,
			    size_t cap);

/**
 * Seals an uplink: `summary` NULL for the slot request. `with_position` picks
 * `live_summary` (0x1) or `live_summary_no_position` (0x2). Returns the packet
 * length (51, 43 or 14 B) or a negative `pod_err`.
 */
int pod_uplink_seal(const uint8_t link_key[16], const struct pod_uplink_counters *c,
		    const struct pod_live_summary *summary, bool with_position, uint8_t *out,
		    size_t cap);

enum pod_led_mode {
	POD_LED_MODE_NORMAL = 0,
	POD_LED_MODE_MATCH = 1,
	POD_LED_MODE_OFF = 2,
};

struct pod_slot_grant {
	uint16_t pod_short_id;
	bool release;
	uint8_t channel; /* 0..7 */
	uint8_t slot;    /* 0..15; 0 is contention and never granted */
};

struct pod_beacon {
	uint16_t network_id;
	/** GPS seconds of the frame, always even. */
	uint32_t gnss_time_s;
	uint8_t key_id;
	bool session_open;
	enum pod_led_mode led_mode;
	uint8_t channel_plan_id;
	uint8_t config_version;
	uint8_t session_seq;
	/** 0 = none. */
	uint32_t session_transition_gnss_s;
	uint8_t grants_n;
	struct pod_slot_grant grants[POD_MAX_GRANTS_PER_BEACON];
};

/** Opens and decodes a beacon with the beacon key. */
int pod_beacon_open(const uint8_t beacon_key[16], const uint8_t *packet, size_t len,
		    struct pod_beacon *out);

struct pod_rtcm_fragment {
	uint16_t network_id;
	uint32_t gnss_time_s;
	uint8_t key_id;
	uint8_t fragment_index;
	uint8_t fragment_count;
	uint8_t data_len;
	uint8_t data[POD_MAX_RTCM_FRAGMENT_BODY_LEN];
};

int pod_rtcm_fragment_open(const uint8_t beacon_key[16], const uint8_t *packet, size_t len,
			   struct pod_rtcm_fragment *out);

/**
 * Next (boot counter, frame) after a 2 s frame (counters.ts `nextLinkCounter`).
 * Sets `*persist` when the boot counter moved and has to be written to NVS
 * before the next transmission. Returns `POD_ERR_EXHAUSTED` at 2^32 − 1.
 */
int pod_next_link_counter(uint32_t *boot_counter, uint16_t *frame_number, bool *persist);

/* KDF (ADR 0106): HKDF-SHA256, empty salt, 16 B out. */
#define POD_KDF_INFO_MAX 64

/** `info` = "sport-performance/pod-kdf/v1/" + label ‖ 0 ‖ u8(len id) ‖ id ‖ u8(epoch). */
int pod_kdf_info(const char *label, const uint8_t *id, size_t id_len, uint8_t epoch,
		 uint8_t *out, size_t cap);

/**
 * Derives a key from the club master key. The pod never holds the master key
 * (it receives its derived keys wrapped by the dock); this is for the
 * provisioning station tooling and the tests.
 */
int pod_derive_key(const uint8_t master_key[32], const char *label, const uint8_t *id,
		   size_t id_len, uint8_t epoch, uint8_t out[16]);

#endif /* POD_RADIO_H_ */
