/*
 * LC29H protocol helpers (docs/hardware/lc29h-protocolo.md): NMEA checksum and
 * command builder, parsers for the messages the pod uses at 10 Hz, the RTCM3
 * framer that splits the mixed UART stream, and the boot / backup command
 * sequences as data. Portable C: the UART glue is app/src/gnss_lc29h.c.
 */
#ifndef POD_GNSS_H_
#define POD_GNSS_H_

#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>

#define POD_NMEA_MAX_LEN 128
/** RTCM3: 0xD3, 6 reserved bits + 10-bit length, payload ≤ 1023 B, CRC-24Q. */
#define POD_RTCM3_PREAMBLE 0xD3
#define POD_RTCM3_MAX_FRAME (3 + 1023 + 3)

/** XOR of every character between `$` and `*` (not included). */
uint8_t pod_nmea_checksum(const char *body, size_t len);

/**
 * Builds `$<body>*XX\r\n` (uppercase hex). `body` has no `$` nor `*`.
 * Returns the length written (without the NUL) or a negative `pod_err`.
 */
int pod_nmea_build(const char *body, char *out, size_t cap);

/**
 * Checks a received line (`$...*XX`, optional CR/LF). On success points `*body`
 * at the text between `$` and `*`.
 */
int pod_nmea_verify(const char *line, size_t len, const char **body, size_t *body_len);

/** `$PAIR001,<id>,<result>` (§2.4.1). */
enum pod_pair_result {
	POD_PAIR_OK = 0,
	POD_PAIR_PROCESSING = 1,
	POD_PAIR_FAILED = 2,
	POD_PAIR_UNSUPPORTED = 3,
	POD_PAIR_PARAM_ERROR = 4,
	POD_PAIR_BUSY = 5,
};

/** Parses a PAIR001 acknowledgement. Returns POD_OK and fills id and result. */
int pod_pair_ack_parse(const char *body, size_t len, uint16_t *cmd_id, int *result);

/**
 * PQTM response to a command `<name>`: `<name>,OK` → 0, `<name>,ERROR,<code>` → code (> 0),
 * anything else → negative `pod_err`.
 */
int pod_pqtm_response_parse(const char *body, size_t len, const char *name);

/** Navigation solution assembled from `$PQTMPVT` (+ `$PQTMVEL` and `$PQTMEPE`). */
struct pod_gnss_pvt {
	bool valid;
	/** GPS time of the epoch, ms since 06/01/1980 (no leap seconds). */
	uint64_t gnss_time_ms;
	/** GPS time of week, ms. */
	uint32_t tow_ms;
	/** Fix mode of PQTMPVT: 0 none, 1 2D? see TODO in gnss.c. */
	uint8_t fix_mode;
	uint8_t satellites_n;
	uint8_t leap_s;
	int32_t lat_e7;
	int32_t lon_e7;
	/** Ellipsoidal height = MSL altitude + geoid separation. */
	int32_t height_ellipsoid_mm;
	int32_t vel_north_mm_s;
	int32_t vel_east_mm_s;
	int32_t vel_down_mm_s;
	uint32_t ground_speed_mm_s;
	uint32_t heading_centi_deg;
	/** From PQTMVEL / PQTMEPE when present; UINT32_MAX = unknown. */
	uint32_t speed_acc_mm_s;
	uint32_t h_acc_mm;
	uint32_t v_acc_mm;
};

/** Parses `$PQTMPVT` (§2.3.12). Field order to be confirmed at the bench (TODO B-901). */
int pod_pqtmpvt_parse(const char *body, size_t len, struct pod_gnss_pvt *out);

/** Merges `$PQTMVEL` (§2.3.27) speed accuracy into `pvt`. */
int pod_pqtmvel_parse(const char *body, size_t len, struct pod_gnss_pvt *pvt);

/** Merges `$PQTMEPE` version 2 (§2.3.4): hAcc = EPE_2D, vAcc = EPE_Down. */
int pod_pqtmepe_parse(const char *body, size_t len, struct pod_gnss_pvt *pvt);

/** GPS ms from a UTC date (YYYYMMDD), time (ms of day) and GPS − UTC. */
uint64_t pod_gps_ms_from_utc(uint32_t yyyymmdd, uint32_t ms_of_day, uint8_t leap_s);

/* ---------------------------------------------------------------------- */
/* Stream splitter: NMEA lines and RTCM3 frames share UART1. */

uint32_t pod_crc24q(const uint8_t *data, size_t len);

typedef void (*pod_gnss_nmea_cb)(void *ctx, const char *line, size_t len);
typedef void (*pod_gnss_rtcm_cb)(void *ctx, const uint8_t *frame, size_t len);

struct pod_gnss_stream {
	pod_gnss_nmea_cb on_nmea;
	pod_gnss_rtcm_cb on_rtcm;
	void *ctx;
	uint8_t buf[POD_RTCM3_MAX_FRAME];
	size_t len;
	size_t rtcm_expected;
	enum { POD_GNSS_IDLE, POD_GNSS_NMEA, POD_GNSS_RTCM } state;
	uint32_t dropped_bytes;
	uint32_t bad_crc_frames;
};

void pod_gnss_stream_init(struct pod_gnss_stream *s, pod_gnss_nmea_cb on_nmea,
			  pod_gnss_rtcm_cb on_rtcm, void *ctx);
void pod_gnss_stream_feed(struct pod_gnss_stream *s, const uint8_t *data, size_t len);

/* ---------------------------------------------------------------------- */
/* Command sequences (lc29h-protocolo.md, "Comandos de arranque recomendados"). */

enum pod_gnss_expect {
	/** Fire and forget. */
	POD_GNSS_EXPECT_NONE = 0,
	/** `$PAIR001,<id>,0` (retry on 5, wait again on 1). */
	POD_GNSS_EXPECT_PAIR_ACK,
	/** `<PQTM name>,OK`. */
	POD_GNSS_EXPECT_PQTM_OK,
	/** A response line starting with the command name (queries). */
	POD_GNSS_EXPECT_RESPONSE,
};

struct pod_gnss_command {
	/** Body without `$` and `*XX`. */
	const char *body;
	enum pod_gnss_expect expect;
	uint16_t timeout_ms;
	/** Wait after the command (e.g. 2 s between $PAIR003 and $PAIR002). */
	uint16_t delay_after_ms;
};

/**
 * LC29H(AA) configuration that writes the NVM: steps 2–3 of the document (GNSS
 * off, 10 Hz, L1+L5, constellations, protocol, $PAIR513, GNSS on). Sent only
 * when the step 1 answers differ from `pod_lc29h_aa_expected`, so the NVM is
 * not worn at every boot.
 */
extern const struct pod_gnss_command pod_lc29h_aa_nvm[];
extern const size_t pod_lc29h_aa_nvm_len;

/** Step 4, with the GNSS on, at every boot: messages, raw, PPS, interference. */
extern const struct pod_gnss_command pod_lc29h_aa_runtime[];
extern const size_t pod_lc29h_aa_runtime_len;

/** Queries of step 1 (version, id and the configuration to compare). */
extern const struct pod_gnss_command pod_lc29h_aa_queries[];
extern const size_t pod_lc29h_aa_queries_len;

/** Expected answer body (between `$` and `*`) of each configuration query. */
struct pod_gnss_expected {
	const char *query;
	const char *answer;
};
extern const struct pod_gnss_expected pod_lc29h_aa_expected[];
extern const size_t pod_lc29h_aa_expected_len;

/**
 * Index in `pod_lc29h_aa_expected` of the query this answer belongs to, or -1.
 * `*matches` says whether it is the expected configuration. TODO(B-901): the
 * exact answer formats come from the bench; an unknown format reads as "does
 * not match", which only costs one NVM write.
 */
int pod_lc29h_check_answer(const char *body, size_t len, bool *matches);

/** Enter backup: `$PAIR650,0`, wait `$PAIR001,650,0` (~100 ms); then GNSS_EN low. */
extern const struct pod_gnss_command pod_lc29h_enter_backup[];
extern const size_t pod_lc29h_enter_backup_len;

/** GNSS pin actions around a backup, for the glue to execute in order. */
enum pod_gnss_pin_step {
	POD_GNSS_STEP_SEND_COMMANDS,
	POD_GNSS_STEP_EN_LOW,
	POD_GNSS_STEP_EN_HIGH,
	POD_GNSS_STEP_WAKEUP_HIGH,
	POD_GNSS_STEP_WAKEUP_RELEASE,
	POD_GNSS_STEP_WAIT_MS,
	POD_GNSS_STEP_WAIT_FIRST_LINE,
};

struct pod_gnss_pin_action {
	enum pod_gnss_pin_step step;
	uint16_t ms;
};

extern const struct pod_gnss_pin_action pod_lc29h_backup_enter_actions[];
extern const size_t pod_lc29h_backup_enter_actions_len;
extern const struct pod_gnss_pin_action pod_lc29h_backup_exit_actions[];
extern const size_t pod_lc29h_backup_exit_actions_len;
/** Full power cycle: VCC < 100 mV for at least 1 s (Hardware Design §3.5). */
extern const struct pod_gnss_pin_action pod_lc29h_power_cycle_actions[];
extern const size_t pod_lc29h_power_cycle_actions_len;

#endif /* POD_GNSS_H_ */
