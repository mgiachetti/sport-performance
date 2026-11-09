/*
 * NAND log format v1 (ADR 0106, packages/pod-protocol/README.md, "Log en la
 * NAND"): TLV records in a byte stream per recording segment, cut into 2048 B
 * pages with a clear 40 B header, AES-128-CTR payload, truncated AES-CMAC and
 * CRC-32. Mirrors log/records.ts, log/page.ts, log/integrity.ts and
 * log/writer.ts; tests/host checks every page against
 * packages/pod-protocol/fixtures/v1/log-vectors.json.
 */
#ifndef POD_LOG_H_
#define POD_LOG_H_

#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>

#define POD_LOG_FORMAT_VERSION 1
#define POD_LOG_PAGE_SIZE 2048
#define POD_LOG_PAGE_HEADER_LEN 40
#define POD_LOG_PAGE_MAC_LEN 8
#define POD_LOG_PAGE_CRC_LEN 4
#define POD_LOG_PAGE_PAYLOAD_CAP                                                               \
	(POD_LOG_PAGE_SIZE - POD_LOG_PAGE_HEADER_LEN - POD_LOG_PAGE_MAC_LEN - POD_LOG_PAGE_CRC_LEN)
#define POD_LOG_PAGE_MAC_OFFSET (POD_LOG_PAGE_HEADER_LEN + POD_LOG_PAGE_PAYLOAD_CAP)
#define POD_LOG_PAGE_CRC_OFFSET (POD_LOG_PAGE_MAC_OFFSET + POD_LOG_PAGE_MAC_LEN)
#define POD_LOG_PAGES_PER_BLOCK 64
#define POD_LOG_NO_RECORD_START 0xFFFFu
#define POD_LOG_IV_DOMAIN 0x4C
#define POD_DEVICE_ID_LEN 8

#define POD_PAGE_FLAG_SEGMENT_START 0x01u
#define POD_PAGE_FLAG_SEGMENT_END 0x02u
#define POD_PAGE_FLAG_CONTINUES 0x04u
#define POD_PAGE_FLAG_RECOVERED 0x08u

#define POD_RECORD_HEADER_LEN 9
/** Largest record the writer encodes in one piece (an IMU batch of ~300 samples). */
#define POD_LOG_MAX_RECORD_LEN 4096

/* Sentinels of the records. */
#define POD_LOG_NO_GNSS_TIME_MS 0xFFFFFFFFFFFFull
#define POD_LOG_UNKNOWN_U16 0xFFFFu
#define POD_LOG_UNKNOWN_U32 0xFFFFFFFFu
#define POD_LOG_UNKNOWN_I16 INT16_MIN
#define POD_LOG_UNKNOWN_U8 0xFFu

enum pod_record_type {
	POD_REC_FIRMWARE_INFO = 0x01,
	POD_REC_CONFIG_APPLIED = 0x02,
	POD_REC_GNSS_PVT = 0x10,
	POD_REC_GNSS_RAW = 0x11,
	POD_REC_IMU_BATCH = 0x20,
	POD_REC_BARO_BATCH = 0x30,
	POD_REC_TIME_ANCHOR = 0x40,
	POD_REC_SENSOR_SYNC = 0x41,
	POD_REC_SEGMENT_MARKER = 0x50,
	POD_REC_HEALTH = 0x60,
	POD_REC_RADIO_TX = 0x70,
	POD_REC_EVENT = 0x71,
};

/* Enumerations: value 0 is never valid (records.ts encodes index + 1). */
enum pod_gnss_raw_format { POD_RAW_RTCM3_MSM7 = 1, POD_RAW_RTCM3_MSM4 = 2, POD_RAW_QUECTEL = 3 };
enum pod_imu_sensor { POD_IMU_LSM6DSV320X = 1, POD_IMU_ICM42688P = 2, POD_IMU_ADXL372 = 3 };
enum pod_imu_channel { POD_IMU_CH_ACCEL_GYRO = 1, POD_IMU_CH_HIGH_G = 2 };
enum pod_baro_sensor { POD_BARO_BMP581 = 1, POD_BARO_DPS368 = 2 };
enum pod_anchor_source { POD_ANCHOR_GNSS_PPS = 1, POD_ANCHOR_BEACON = 2, POD_ANCHOR_DOCK = 3 };
enum pod_marker_kind {
	POD_MARK_RECORDING_START = 1,
	POD_MARK_RECORDING_STOP = 2,
	POD_MARK_VEST_ON = 3,
	POD_MARK_VEST_OFF = 4,
	POD_MARK_MOTION_START = 5,
	POD_MARK_MOTION_STOP = 6,
	POD_MARK_STAFF_SESSION_OPEN = 7,
	POD_MARK_STAFF_SESSION_CLOSE = 8,
};
enum pod_start_reason { POD_START_UNDOCKED = 1, POD_START_VEST_ON, POD_START_MOTION, POD_START_COMMAND };
enum pod_stop_reason {
	POD_STOP_DOCKED = 1,
	POD_STOP_BATTERY_LOW,
	POD_STOP_MEMORY_FULL,
	POD_STOP_SHUTDOWN,
	POD_STOP_IDLE_TIMEOUT,
};
enum pod_event_code {
	POD_EVT_IMU_FIFO_OVERRUN = 1,
	POD_EVT_GNSS_RESET,
	POD_EVT_CONFIG_REJECTED,
	POD_EVT_NAND_PROGRAM_FAILED,
	POD_EVT_NAND_ERASE_FAILED,
	POD_EVT_BROWNOUT,
	POD_EVT_WATCHDOG,
};
/* Bitmasks of `config_applied` (bit = enum index). */
#define POD_CNST_GPS (1u << 0)
#define POD_CNST_GLONASS (1u << 1)
#define POD_CNST_GALILEO (1u << 2)
#define POD_CNST_BEIDOU (1u << 3)
#define POD_CNST_QZSS (1u << 4)
#define POD_CNST_NAVIC (1u << 5)
#define POD_BAND_L1 (1u << 0)
#define POD_BAND_L5 (1u << 1)

struct pod_rec_firmware_info {
	uint8_t major;
	uint8_t minor;
	uint16_t patch;
	uint32_t build_id;
	uint8_t hardware_revision;
	uint16_t algorithm_version;
	uint8_t radio_protocol_version;
	uint8_t log_format_version;
	/** NUL-terminated ASCII, ≤ 64 characters (`$PQTMVERNO`). */
	const char *gnss_firmware;
};

struct pod_rec_config_applied {
	uint32_t config_version;
	uint8_t config_hash[8];
	uint8_t gnss_pvt_rate_hz;
	uint8_t gnss_raw_rate_hz;
	uint8_t constellations;
	uint8_t bands;
};

/** `POD_LOG_UNKNOWN_*` for "no data". Fix quality uses the radio table (0-based). */
struct pod_rec_gnss_pvt {
	uint64_t gnss_time_ms;
	int32_t lat_e7;
	int32_t lon_e7;
	int32_t height_ellipsoid_mm;
	int16_t vel_north_mm_s;
	int16_t vel_east_mm_s;
	int16_t vel_down_mm_s;
	uint16_t ground_speed_mm_s;
	uint16_t heading_centi_deg;
	uint16_t h_acc_mm;
	uint16_t v_acc_mm;
	uint16_t speed_acc_mm_s;
	uint8_t fix_quality;
	uint8_t satellites_n;
};

struct pod_rec_gnss_raw {
	uint8_t format;
	/** `POD_LOG_NO_GNSS_TIME_MS` = unknown. */
	uint64_t gnss_time_ms;
	const uint8_t *data;
	uint16_t data_len;
};

struct pod_rec_imu_batch {
	uint8_t sensor;
	uint8_t channel;
	bool fifo_overrun;
	bool impact_burst;
	uint16_t accel_range_g;
	uint16_t gyro_range_dps;
	uint32_t odr_milli_hz;
	uint32_t sensor_tick_period_ns;
	uint32_t first_sensor_timestamp;
	uint32_t last_sensor_timestamp;
	uint16_t samples_n;
	/** samples_n × 6 (accel_gyro) or × 3 (high_g) raw LSB. */
	const int16_t *samples;
};

struct pod_baro_sample {
	uint32_t pressure_centi_pa; /* u24 */
	int16_t temperature_centi_c;
};

struct pod_rec_baro_batch {
	uint8_t sensor;
	uint32_t odr_milli_hz;
	uint32_t last_sample_delta_ticks;
	uint16_t samples_n;
	const struct pod_baro_sample *samples;
};

struct pod_rec_time_anchor {
	uint8_t source;
	uint16_t sub_tick_ns;
	uint64_t gnss_time_ms;
	/** `POD_LOG_UNKNOWN_U32` = unknown. */
	uint32_t uncertainty_us;
	/** `POD_LOG_UNKNOWN_U8` = unknown. */
	uint8_t gps_utc_offset_s;
};

struct pod_rec_sensor_sync {
	uint8_t sensor;
	uint16_t sub_tick_ns;
	uint32_t sensor_timestamp;
};

struct pod_rec_segment_marker {
	uint8_t kind;
	/** Start / stop reason, or the beacon session sequence; 0 otherwise. */
	uint8_t detail;
	/** GPS seconds of the staff open / close, 0 if it does not apply. */
	uint32_t transition_gnss_s;
};

struct pod_rec_health {
	/** 127 = unknown. */
	uint8_t battery_pct;
	/** 0 = unknown. */
	uint16_t battery_mv;
	int16_t battery_temp_centi_c;
	int16_t mcu_temp_centi_c;
	uint16_t charge_cycles_n;
	uint16_t bad_blocks_n;
	uint16_t free_blocks_n;
	uint16_t ecc_corrected_n;
};

struct pod_rec_radio_tx {
	uint16_t frame_number;
	uint32_t duration_us;
	int8_t tx_power_dbm;
	uint8_t message_type_byte;
};

struct pod_rec_event {
	uint16_t code;
	uint32_t value;
};

/** Opaque record of a type this firmware does not model (tests, experiments). */
struct pod_rec_raw {
	const uint8_t *body;
	uint16_t body_len;
};

struct pod_log_record {
	uint8_t type;
	/** RTC ticks (32,768 Hz) since boot, u48. */
	uint64_t tick;
	union {
		struct pod_rec_firmware_info firmware_info;
		struct pod_rec_config_applied config_applied;
		struct pod_rec_gnss_pvt gnss_pvt;
		struct pod_rec_gnss_raw gnss_raw;
		struct pod_rec_imu_batch imu_batch;
		struct pod_rec_baro_batch baro_batch;
		struct pod_rec_time_anchor time_anchor;
		struct pod_rec_sensor_sync sensor_sync;
		struct pod_rec_segment_marker segment_marker;
		struct pod_rec_health health;
		struct pod_rec_radio_tx radio_tx;
		struct pod_rec_event event;
		struct pod_rec_raw raw;
	} u;
};

/** Encoded length of a record (header + body), or a negative `pod_err`. */
int pod_record_length(const struct pod_log_record *r);

/** Encodes one record. Returns its length or a negative `pod_err`. */
int pod_record_encode(const struct pod_log_record *r, uint8_t *out, size_t cap);

/* ---------------------------------------------------------------------- */
/* Pages. */

struct pod_log_page_header {
	uint8_t key_epoch;
	bool segment_start;
	bool segment_end;
	bool continues;
	bool recovered;
	uint8_t device_id[POD_DEVICE_ID_LEN];
	uint32_t boot_counter;
	uint32_t segment_id;
	uint32_t page_seq;
	uint32_t stream_offset;
	uint16_t payload_len;
	/** `POD_LOG_NO_RECORD_START` when the page only continues a record. */
	uint16_t first_record_offset;
	uint16_t record_count;
};

struct pod_log_page_keys {
	uint8_t enc_key[16];
	uint8_t mac_key[16];
};

/** CRC-32 (IEEE 802.3, the zlib one). */
uint32_t pod_crc32(const uint8_t *data, size_t len);

/** Initial CTR block: 0x4C ‖ epoch ‖ page sequence (u32 LE) ‖ 6 zeros ‖ block counter 0 (u32 BE). */
void pod_log_page_iv(uint8_t key_epoch, uint32_t page_seq, uint8_t iv[16]);

/** CTR and CMAC keys from the storage key of an epoch (HKDF-SHA256, ".../pod-log/v1/ctr|cmac"). */
int pod_log_derive_page_keys(const uint8_t storage_key[16], struct pod_log_page_keys *keys);

/** Clear 40 B header. */
int pod_log_page_header_encode(const struct pod_log_page_header *h,
			       uint8_t out[POD_LOG_PAGE_HEADER_LEN]);

/** Seals a page: header, zero-padded CTR payload, CMAC (8 B) and CRC-32. */
int pod_log_page_seal(const struct pod_log_page_header *h, const uint8_t *payload,
		      const struct pod_log_page_keys *keys, uint8_t page[POD_LOG_PAGE_SIZE]);

/* ---------------------------------------------------------------------- */
/* Writer (log/writer.ts `LogWriter`). */

/** Receives every sealed page, in order; the caller programs it into the NAND. */
typedef int (*pod_log_page_sink_t)(void *ctx, const uint8_t page[POD_LOG_PAGE_SIZE]);

/**
 * Hands out the page sequence of the next sealed page (pod_counters_take_page_seq
 * on the pod). An error stops the seal: the page stays buffered, nothing is written.
 */
typedef int (*pod_log_seq_source_t)(void *ctx, uint32_t *page_seq);

struct pod_log_writer_options {
	uint8_t device_id[POD_DEVICE_ID_LEN];
	uint32_t boot_counter;
	uint32_t segment_id;
	/** Used only without `seq_source` (reference encoder, fixtures). */
	uint32_t first_page_seq;
	uint8_t key_epoch;
	/** Source of page sequences shared by every segment of the pod (never reused). */
	pod_log_seq_source_t seq_source;
	void *seq_ctx;
};

struct pod_log_writer {
	struct pod_log_writer_options opt;
	uint8_t key_epoch;
	struct pod_log_page_keys keys;
	uint64_t next_page_seq;
	uint32_t stream_offset;
	uint8_t buffer[POD_LOG_PAGE_PAYLOAD_CAP];
	uint16_t length;
	uint16_t first_record_offset;
	uint16_t record_count;
	bool closed;
	pod_log_page_sink_t sink;
	void *sink_ctx;
	uint8_t page[POD_LOG_PAGE_SIZE];
	uint8_t scratch[POD_LOG_MAX_RECORD_LEN];
};

/** POD_ERR_STATE with an all-zero (unprovisioned) storage key. */
int pod_log_writer_init(struct pod_log_writer *w, const struct pod_log_writer_options *opt,
			const uint8_t storage_key[16], pod_log_page_sink_t sink, void *sink_ctx);

/** New storage key (rotation at the dock); applies from the page being filled. */
int pod_log_writer_rotate_key(struct pod_log_writer *w, uint8_t key_epoch,
			      const uint8_t storage_key[16]);

/** Pages that appending `record_len` bytes would seal (checked against `mayAppend`). */
unsigned int pod_log_writer_pages_sealed_by(const struct pod_log_writer *w, size_t record_len);

/** Appends an encoded record; sealed pages go to the sink. */
int pod_log_writer_append_bytes(struct pod_log_writer *w, const uint8_t *record, size_t len);

/** Encodes and appends one record. */
int pod_log_writer_append(struct pod_log_writer *w, const struct pod_log_record *r);

/** Seals the page being filled even if not full (before sleeping). */
int pod_log_writer_flush(struct pod_log_writer *w);

/** Closes the segment with a segment-end page (empty on a page boundary). */
int pod_log_writer_close(struct pod_log_writer *w);

/**
 * Recovery close of a segment a power loss left open (writer.ts `sealRecoveryPage`).
 * `page_seq` must come from the same source as every other page
 * (pod_counters_take_page_seq on the pod), never be computed by the caller.
 */
int pod_log_seal_recovery_page(const uint8_t device_id[POD_DEVICE_ID_LEN], uint32_t boot_counter,
			       uint32_t segment_id, uint32_t stream_offset, uint32_t page_seq,
			       uint8_t key_epoch, const uint8_t storage_key[16],
			       uint8_t page[POD_LOG_PAGE_SIZE]);

#endif /* POD_LOG_H_ */
