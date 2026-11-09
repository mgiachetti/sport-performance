/*
 * LC29H protocol helpers (see pod/gnss.h and docs/hardware/lc29h-protocolo.md).
 * Integer-only parsing: no float on the hot path of a 10 Hz stream.
 */
#include <string.h>

#include "pod/errors.h"
#include "pod/gnss.h"

static const char hex_digits[] = "0123456789ABCDEF";

uint8_t pod_nmea_checksum(const char *body, size_t len)
{
	uint8_t x = 0;

	for (size_t i = 0; i < len; i++) {
		x ^= (uint8_t)body[i];
	}
	return x;
}

int pod_nmea_build(const char *body, char *out, size_t cap)
{
	size_t n = strlen(body);
	uint8_t cs;

	if (n == 0 || memchr(body, '$', n) != NULL || memchr(body, '*', n) != NULL) {
		return POD_ERR_RANGE;
	}
	if (cap < n + 7) { /* $ + body + *XX + CR LF + NUL */
		return POD_ERR_LENGTH;
	}
	cs = pod_nmea_checksum(body, n);
	out[0] = '$';
	memcpy(&out[1], body, n);
	out[n + 1] = '*';
	out[n + 2] = hex_digits[cs >> 4];
	out[n + 3] = hex_digits[cs & 0x0f];
	out[n + 4] = '\r';
	out[n + 5] = '\n';
	out[n + 6] = '\0';
	return (int)(n + 6);
}

static int hex_value(char c)
{
	if (c >= '0' && c <= '9') {
		return c - '0';
	}
	if (c >= 'A' && c <= 'F') {
		return c - 'A' + 10;
	}
	if (c >= 'a' && c <= 'f') {
		return c - 'a' + 10;
	}
	return -1;
}

int pod_nmea_verify(const char *line, size_t len, const char **body, size_t *body_len)
{
	const char *star;
	int hi, lo;

	while (len > 0 && (line[len - 1] == '\r' || line[len - 1] == '\n')) {
		len--;
	}
	if (len < 4 || line[0] != '$') {
		return POD_ERR_PARSE;
	}
	star = memchr(line, '*', len);
	if (star == NULL || (size_t)(star - line) + 3 != len) {
		return POD_ERR_PARSE;
	}
	hi = hex_value(star[1]);
	lo = hex_value(star[2]);
	if (hi < 0 || lo < 0) {
		return POD_ERR_PARSE;
	}
	*body = &line[1];
	*body_len = (size_t)(star - line) - 1;
	if (pod_nmea_checksum(*body, *body_len) != (uint8_t)((hi << 4) | lo)) {
		return POD_ERR_AUTH;
	}
	return POD_OK;
}

/* ------------------------------------------------------------------------ */
/* Field helpers. */

#define MAX_FIELDS 24

struct fields {
	const char *start[MAX_FIELDS];
	size_t len[MAX_FIELDS];
	size_t n;
};

static void split(const char *body, size_t len, struct fields *f)
{
	size_t begin = 0;

	f->n = 0;
	for (size_t i = 0; i <= len && f->n < MAX_FIELDS; i++) {
		if (i == len || body[i] == ',') {
			f->start[f->n] = &body[begin];
			f->len[f->n] = i - begin;
			f->n++;
			begin = i + 1;
		}
	}
}

static int field_is(const struct fields *f, size_t i, const char *s)
{
	size_t n = strlen(s);

	return i < f->n && f->len[i] == n && memcmp(f->start[i], s, n) == 0;
}

/** Unsigned integer field. */
static int parse_uint(const char *s, size_t len, uint32_t *out)
{
	uint64_t v = 0;

	if (len == 0) {
		return POD_ERR_PARSE;
	}
	for (size_t i = 0; i < len; i++) {
		if (s[i] < '0' || s[i] > '9') {
			return POD_ERR_PARSE;
		}
		v = v * 10u + (uint64_t)(s[i] - '0');
		if (v > 0xffffffffull) {
			return POD_ERR_RANGE;
		}
	}
	*out = (uint32_t)v;
	return POD_OK;
}

/**
 * Decimal field ("-34.5123456") to an integer scaled by 10^digits, rounded half
 * away from zero.
 */
static int parse_fixed(const char *s, size_t len, unsigned int digits, int64_t *out)
{
	int64_t v = 0;
	int neg = 0;
	size_t i = 0;
	unsigned int frac = 0;
	int seen_digit = 0;
	int dot = 0;
	int round_up = 0;

	if (len == 0) {
		return POD_ERR_PARSE;
	}
	if (s[0] == '-' || s[0] == '+') {
		neg = s[0] == '-';
		i = 1;
	}
	for (; i < len; i++) {
		char c = s[i];

		if (c == '.') {
			if (dot) {
				return POD_ERR_PARSE;
			}
			dot = 1;
			continue;
		}
		if (c < '0' || c > '9') {
			return POD_ERR_PARSE;
		}
		seen_digit = 1;
		if (dot) {
			if (frac == digits) {
				if (frac == digits && !round_up && c >= '5') {
					round_up = 1;
				}
				frac++;
				continue;
			}
			if (frac > digits) {
				continue;
			}
			frac++;
		}
		v = v * 10 + (c - '0');
		if (v > (int64_t)1 << 52) {
			return POD_ERR_RANGE;
		}
	}
	if (!seen_digit) {
		return POD_ERR_PARSE;
	}
	if (frac > digits) {
		frac = digits;
	}
	for (; frac < digits; frac++) {
		v *= 10;
	}
	v += round_up;
	*out = neg ? -v : v;
	return POD_OK;
}

static int fixed_field(const struct fields *f, size_t i, unsigned int digits, int64_t *out)
{
	if (i >= f->n) {
		return POD_ERR_PARSE;
	}
	return parse_fixed(f->start[i], f->len[i], digits, out);
}

static uint32_t clamp_u32(int64_t v)
{
	if (v < 0) {
		return 0;
	}
	return v > 0xfffffffe ? 0xfffffffeu : (uint32_t)v;
}

/* ------------------------------------------------------------------------ */
/* Responses. */

int pod_pair_ack_parse(const char *body, size_t len, uint16_t *cmd_id, int *result)
{
	struct fields f;
	uint32_t id, res;

	split(body, len, &f);
	if (!field_is(&f, 0, "PAIR001") || f.n < 3) {
		return POD_ERR_TYPE;
	}
	if (parse_uint(f.start[1], f.len[1], &id) != POD_OK || id > 0xffff ||
	    parse_uint(f.start[2], f.len[2], &res) != POD_OK) {
		return POD_ERR_PARSE;
	}
	*cmd_id = (uint16_t)id;
	*result = (int)res;
	return POD_OK;
}

int pod_pqtm_response_parse(const char *body, size_t len, const char *name)
{
	struct fields f;
	uint32_t code;

	split(body, len, &f);
	if (!field_is(&f, 0, name)) {
		return POD_ERR_TYPE;
	}
	if (field_is(&f, 1, "OK")) {
		return 0;
	}
	if (field_is(&f, 1, "ERROR") && f.n >= 3 &&
	    parse_uint(f.start[2], f.len[2], &code) == POD_OK && code > 0) {
		return (int)code;
	}
	return POD_ERR_PARSE;
}

/* ------------------------------------------------------------------------ */
/* Time. */

/* Days from 1970-01-01 to y-m-d (proleptic Gregorian, H. Hinnant's algorithm). */
static int64_t days_from_civil(int64_t y, unsigned int m, unsigned int d)
{
	int64_t era;
	unsigned int yoe, doy, doe;

	y -= m <= 2;
	era = (y >= 0 ? y : y - 399) / 400;
	yoe = (unsigned int)(y - era * 400);
	doy = (153 * (m + (m > 2 ? -3 : 9)) + 2) / 5 + d - 1;
	doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
	return era * 146097 + (int64_t)doe - 719468;
}

#define GPS_EPOCH_UNIX_MS 315964800000ll

uint64_t pod_gps_ms_from_utc(uint32_t yyyymmdd, uint32_t ms_of_day, uint8_t leap_s)
{
	int64_t days = days_from_civil((int64_t)(yyyymmdd / 10000), (yyyymmdd / 100) % 100,
				       yyyymmdd % 100);
	int64_t unix_ms = days * 86400000ll + (int64_t)ms_of_day;

	return (uint64_t)(unix_ms - GPS_EPOCH_UNIX_MS + (int64_t)leap_s * 1000);
}

/* "hhmmss.sss" → ms of day. */
static int parse_utc_time(const char *s, size_t len, uint32_t *ms)
{
	int64_t v;
	uint32_t hh, mm, ss_ms;

	if (parse_fixed(s, len, 3, &v) != POD_OK || v < 0) {
		return POD_ERR_PARSE;
	}
	/* v = hhmmss * 1000 + ms */
	hh = (uint32_t)(v / 10000000);
	mm = (uint32_t)((v / 100000) % 100);
	ss_ms = (uint32_t)(v % 100000);
	if (hh > 23 || mm > 59 || ss_ms > 60999) {
		return POD_ERR_RANGE;
	}
	*ms = hh * 3600000u + mm * 60000u + ss_ms;
	return POD_OK;
}

/* ------------------------------------------------------------------------ */
/* Navigation messages. */

/*
 * $PQTMPVT,<MsgVer>,<TOW>,<Date>,<Time>,<Res>,<FixMode>,<NumSat>,<LeapS>,<Lat>,<Lon>,
 *          <Alt>,<Sep>,<VelN>,<VelE>,<VelD>,<Spd>,<Heading>,<HDOP>,<PDOP>
 *
 * TODO(B-901): confirm the field order and the FixMode values against §2.3.12
 * (pp. 50–52) of the Protocol Specification V1.5 with a real capture at the
 * bench; the parser keeps to the published example layout until then.
 */
int pod_pqtmpvt_parse(const char *body, size_t len, struct pod_gnss_pvt *out)
{
	struct fields f;
	uint32_t tow, date, ms_of_day, fix, sats, leap;
	int64_t lat, lon, alt, sep, vn, ve, vd, spd, heading;

	split(body, len, &f);
	if (!field_is(&f, 0, "PQTMPVT")) {
		return POD_ERR_TYPE;
	}
	if (f.n < 20) {
		return POD_ERR_PARSE;
	}
	memset(out, 0, sizeof(*out));
	out->speed_acc_mm_s = UINT32_MAX;
	out->h_acc_mm = UINT32_MAX;
	out->v_acc_mm = UINT32_MAX;
	if (parse_uint(f.start[6], f.len[6], &fix) != POD_OK || fix > 0xff) {
		return POD_ERR_PARSE;
	}
	out->fix_mode = (uint8_t)fix;
	if (fix == 0) {
		/* No fix: the remaining fields can be empty. */
		return POD_OK;
	}
	if (parse_uint(f.start[2], f.len[2], &tow) != POD_OK ||
	    parse_uint(f.start[3], f.len[3], &date) != POD_OK ||
	    parse_utc_time(f.start[4], f.len[4], &ms_of_day) != POD_OK ||
	    parse_uint(f.start[7], f.len[7], &sats) != POD_OK ||
	    parse_uint(f.start[8], f.len[8], &leap) != POD_OK || sats > 0xff || leap > 0xff) {
		return POD_ERR_PARSE;
	}
	if (fixed_field(&f, 9, 7, &lat) != POD_OK || fixed_field(&f, 10, 7, &lon) != POD_OK ||
	    fixed_field(&f, 11, 3, &alt) != POD_OK || fixed_field(&f, 12, 3, &sep) != POD_OK ||
	    fixed_field(&f, 13, 3, &vn) != POD_OK || fixed_field(&f, 14, 3, &ve) != POD_OK ||
	    fixed_field(&f, 15, 3, &vd) != POD_OK || fixed_field(&f, 16, 3, &spd) != POD_OK ||
	    fixed_field(&f, 17, 2, &heading) != POD_OK) {
		return POD_ERR_PARSE;
	}
	if (lat < -900000000 || lat > 900000000 || lon < -1800000000 || lon > 1800000000) {
		return POD_ERR_RANGE;
	}
	out->tow_ms = tow;
	out->satellites_n = (uint8_t)sats;
	out->leap_s = (uint8_t)leap;
	out->gnss_time_ms = pod_gps_ms_from_utc(date, ms_of_day, (uint8_t)leap);
	out->lat_e7 = (int32_t)lat;
	out->lon_e7 = (int32_t)lon;
	out->height_ellipsoid_mm = (int32_t)(alt + sep);
	out->vel_north_mm_s = (int32_t)vn;
	out->vel_east_mm_s = (int32_t)ve;
	out->vel_down_mm_s = (int32_t)vd;
	out->ground_speed_mm_s = clamp_u32(spd);
	out->heading_centi_deg = clamp_u32(heading) % 36000u;
	out->valid = true;
	return POD_OK;
}

/* $PQTMVEL,<MsgVer>,<Time>,<VelN>,<VelE>,<VelD>,<GrdSpd>,<Spd>,<Heading>,<GrdSpdAcc>,<SpdAcc>,<HeadingAcc> */
int pod_pqtmvel_parse(const char *body, size_t len, struct pod_gnss_pvt *pvt)
{
	struct fields f;
	int64_t acc;

	split(body, len, &f);
	if (!field_is(&f, 0, "PQTMVEL")) {
		return POD_ERR_TYPE;
	}
	if (f.n < 12 || fixed_field(&f, 9, 3, &acc) != POD_OK) {
		return POD_ERR_PARSE;
	}
	pvt->speed_acc_mm_s = clamp_u32(acc);
	return POD_OK;
}

/* $PQTMEPE,2,<EPE_North>,<EPE_East>,<EPE_Down>,<EPE_2D>,<EPE_3D> */
int pod_pqtmepe_parse(const char *body, size_t len, struct pod_gnss_pvt *pvt)
{
	struct fields f;
	int64_t down, h2d;

	split(body, len, &f);
	if (!field_is(&f, 0, "PQTMEPE")) {
		return POD_ERR_TYPE;
	}
	if (f.n < 7 || !field_is(&f, 1, "2") || fixed_field(&f, 4, 3, &down) != POD_OK ||
	    fixed_field(&f, 5, 3, &h2d) != POD_OK) {
		return POD_ERR_PARSE;
	}
	pvt->v_acc_mm = clamp_u32(down);
	pvt->h_acc_mm = clamp_u32(h2d);
	return POD_OK;
}

/* ------------------------------------------------------------------------ */
/* Stream splitter. */

uint32_t pod_crc24q(const uint8_t *data, size_t len)
{
	uint32_t crc = 0;

	for (size_t i = 0; i < len; i++) {
		crc ^= (uint32_t)data[i] << 16;
		for (unsigned int k = 0; k < 8; k++) {
			crc <<= 1;
			if (crc & 0x1000000u) {
				crc ^= 0x1864CFBu;
			}
		}
	}
	return crc & 0xffffffu;
}

void pod_gnss_stream_init(struct pod_gnss_stream *s, pod_gnss_nmea_cb on_nmea,
			  pod_gnss_rtcm_cb on_rtcm, void *ctx)
{
	memset(s, 0, sizeof(*s));
	s->on_nmea = on_nmea;
	s->on_rtcm = on_rtcm;
	s->ctx = ctx;
	s->state = POD_GNSS_IDLE;
}

void pod_gnss_stream_feed(struct pod_gnss_stream *s, const uint8_t *data, size_t len)
{
	for (size_t i = 0; i < len; i++) {
		uint8_t b = data[i];

		switch (s->state) {
		case POD_GNSS_IDLE:
			if (b == '$') {
				s->buf[0] = b;
				s->len = 1;
				s->state = POD_GNSS_NMEA;
			} else if (b == POD_RTCM3_PREAMBLE) {
				s->buf[0] = b;
				s->len = 1;
				s->rtcm_expected = 0;
				s->state = POD_GNSS_RTCM;
			} else if (b != '\r' && b != '\n') {
				s->dropped_bytes++;
			}
			break;
		case POD_GNSS_NMEA:
			if (b == '\n' || b == '\r') {
				if (s->on_nmea) {
					s->on_nmea(s->ctx, (const char *)s->buf, s->len);
				}
				s->state = POD_GNSS_IDLE;
			} else if (s->len >= POD_NMEA_MAX_LEN || b == '$' ||
				   b == POD_RTCM3_PREAMBLE) {
				/* Overlong or interrupted line: drop it and resync on this byte. */
				s->dropped_bytes += (uint32_t)s->len;
				s->state = POD_GNSS_IDLE;
				pod_gnss_stream_feed(s, &b, 1);
			} else {
				s->buf[s->len++] = b;
			}
			break;
		case POD_GNSS_RTCM:
			s->buf[s->len++] = b;
			if (s->len == 3) {
				size_t payload = ((size_t)(s->buf[1] & 0x03u) << 8) | s->buf[2];

				if ((s->buf[1] & 0xfcu) != 0) {
					/* Reserved bits set: not a frame. */
					s->dropped_bytes += 3;
					s->state = POD_GNSS_IDLE;
					break;
				}
				s->rtcm_expected = 3 + payload + 3;
			}
			if (s->rtcm_expected != 0 && s->len == s->rtcm_expected) {
				size_t body = s->len - 3;
				uint32_t crc = ((uint32_t)s->buf[body] << 16) |
					       ((uint32_t)s->buf[body + 1] << 8) | s->buf[body + 2];

				if (pod_crc24q(s->buf, body) == crc) {
					if (s->on_rtcm) {
						s->on_rtcm(s->ctx, s->buf, s->len);
					}
				} else {
					s->bad_crc_frames++;
				}
				s->state = POD_GNSS_IDLE;
			}
			break;
		}
	}
}

/* ------------------------------------------------------------------------ */
/* Sequences. Derived from the Protocol Specification V1.5 and not yet run on a
 * module: validated at the bench (banco-gnss.md, B-901) before relying on them.
 */

#define PAIR(body, after) {body, POD_GNSS_EXPECT_PAIR_ACK, 500, after}
#define PQTM(body) {body, POD_GNSS_EXPECT_PQTM_OK, 500, 0}
#define QUERY(body) {body, POD_GNSS_EXPECT_RESPONSE, 500, 0}

const struct pod_gnss_command pod_lc29h_aa_queries[] = {
	QUERY("PQTMVERNO"),    QUERY("PQTMUNIQID"), QUERY("PAIR051"), QUERY("PAIR105"),
	QUERY("PAIR067"),      QUERY("PAIR081"),    QUERY("PAIR071"), QUERY("PAIR433"),
	QUERY("PAIR437"),      QUERY("PQTMCFGPROT,R,1,1"),
};
const size_t pod_lc29h_aa_queries_len =
	sizeof(pod_lc29h_aa_queries) / sizeof(pod_lc29h_aa_queries[0]);

const struct pod_gnss_command pod_lc29h_aa_boot[] = {
	/* 2. GNSS off, commands still enabled. */
	PAIR("PAIR382,1", 0),
	/* At least 2 s between $PAIR003 and $PAIR002. */
	PAIR("PAIR003", 2000),
	/* 3. Configuration that needs the GNSS off, then save. */
	PAIR("PAIR050,100", 0),         /* 10 Hz */
	PAIR("PAIR104,1", 0),           /* L1 + L5 */
	PAIR("PAIR066,1,1,1,1,1,0", 0), /* GPS + GLONASS + Galileo + BeiDou + QZSS */
	PAIR("PAIR080,0", 0),           /* normal navigation mode (fitness: bench) */
	PAIR("PAIR070,0", 0),           /* no static threshold */
	PAIR("PAIR410,0", 0),           /* SBAS off */
	PAIR("PAIR400,0", 0),           /* no DGPS source */
	PQTM("PQTMCFGPROT,W,1,1,1,5"),  /* UART1: NMEA in, NMEA + RTCM3 out */
	PAIR("PAIR513", 0),             /* save to NVM */
	PAIR("PAIR002", 0),             /* GNSS on */
	/* 4. Messages, raw, PPS and interference, with the GNSS on. */
	PAIR("PAIR062,0,0", 0),
	PAIR("PAIR062,1,0", 0),
	PAIR("PAIR062,2,0", 0),
	PAIR("PAIR062,3,10", 0), /* GSV at 1 Hz */
	PAIR("PAIR062,4,0", 0),
	PAIR("PAIR062,5,0", 0),
	PAIR("PAIR062,6,0", 0),
	PAIR("PAIR062,7,0", 0),
	PAIR("PAIR062,8,0", 0),
	PAIR("PAIR062,9,0", 0),
	PQTM("PQTMCFGMSGRATE,W,PQTMPVT,1,1"),
	PQTM("PQTMCFGMSGRATE,W,PQTMVEL,1,1"),
	PQTM("PQTMCFGMSGRATE,W,PQTMEPE,1,2"),
	PQTM("PQTMCFGMSGRATE,W,PQTMDOP,10,1"),
	PQTM("PQTMCFGMSGRATE,W,PQTMJAMMINGSTATUS,10,1"),
	PAIR("PAIR432,1", 0), /* RTCM3 MSM7; the firmware logs 1 Hz */
	PAIR("PAIR436,1", 0), /* ephemerides in RTCM */
	PAIR("PAIR434,0", 0), /* no 1005 */
	PAIR("PAIR752,1,100", 0),
	QUERY("PQTMCFGPPS,R,1"), /* polarity must read 1 (high) */
	PAIR("PAIR391,1", 0),
	PAIR("PAIR074,1", 0),
};
const size_t pod_lc29h_aa_boot_len = sizeof(pod_lc29h_aa_boot) / sizeof(pod_lc29h_aa_boot[0]);

const struct pod_gnss_command pod_lc29h_enter_backup[] = {
	/* Answers $PAIR001,650,0 and then $PAIR650,0; about 100 ms. */
	{"PAIR650,0", POD_GNSS_EXPECT_PAIR_ACK, 100, 0},
};
const size_t pod_lc29h_enter_backup_len =
	sizeof(pod_lc29h_enter_backup) / sizeof(pod_lc29h_enter_backup[0]);

const struct pod_gnss_pin_action pod_lc29h_backup_enter_actions[] = {
	{POD_GNSS_STEP_SEND_COMMANDS, 0}, /* pod_lc29h_enter_backup */
	{POD_GNSS_STEP_EN_LOW, 0},        /* LDO with active discharge; V_BCKP stays on */
};
const size_t pod_lc29h_backup_enter_actions_len =
	sizeof(pod_lc29h_backup_enter_actions) / sizeof(pod_lc29h_backup_enter_actions[0]);

const struct pod_gnss_pin_action pod_lc29h_backup_exit_actions[] = {
	{POD_GNSS_STEP_EN_HIGH, 0},
	{POD_GNSS_STEP_WAKEUP_HIGH, 0},
	{POD_GNSS_STEP_WAIT_MS, 10}, /* WAKEUP high ≥ 10 ms */
	{POD_GNSS_STEP_WAKEUP_RELEASE, 0},
	{POD_GNSS_STEP_WAIT_FIRST_LINE, 1000}, /* first NMEA or $PQTMVER */
};
const size_t pod_lc29h_backup_exit_actions_len =
	sizeof(pod_lc29h_backup_exit_actions) / sizeof(pod_lc29h_backup_exit_actions[0]);

const struct pod_gnss_pin_action pod_lc29h_power_cycle_actions[] = {
	{POD_GNSS_STEP_EN_LOW, 0},
	{POD_GNSS_STEP_WAIT_MS, 1000},
	{POD_GNSS_STEP_EN_HIGH, 0},
	{POD_GNSS_STEP_WAIT_FIRST_LINE, 1000},
};
const size_t pod_lc29h_power_cycle_actions_len =
	sizeof(pod_lc29h_power_cycle_actions) / sizeof(pod_lc29h_power_cycle_actions[0]);
