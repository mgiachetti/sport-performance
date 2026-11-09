/*
 * LC29H helpers: checksums against the commands published in
 * docs/hardware/lc29h-protocolo.md (themselves checked against the examples of
 * the Quectel specification), the parsers and the NMEA / RTCM3 splitter.
 */
#include <string.h>

#include "pod/errors.h"
#include "pod/gnss.h"
#include "test.h"

#define COUNT(a) (sizeof(a) / sizeof((a)[0]))

/* Every line, as written in lc29h-protocolo.md. */
static const char *const documented[] = {
	"$PQTMVERNO*58",
	"$PQTMUNIQID*16",
	"$PAIR864,0,0,921600*10",
	"$PAIR513*3D",
	"$PQTMSRR*4B",
	"$PAIR382,1*2E",
	"$PAIR003*39",
	"$PAIR002*38",
	"$PAIR051*3E",
	"$PAIR105*3E",
	"$PAIR067*3B",
	"$PAIR081*33",
	"$PAIR071*3C",
	"$PAIR433*3E",
	"$PAIR437*3A",
	"$PQTMCFGPROT,R,1,1*3D",
	"$PAIR050,100*22",
	"$PAIR050,1000*12",
	"$PAIR104,1*22",
	"$PAIR066,1,1,1,1,1,0*3B",
	"$PAIR080,0*2E",
	"$PAIR070,0*21",
	"$PAIR410,0*23",
	"$PAIR400,0*22",
	"$PQTMCFGPROT,W,1,1,1,5*3C",
	"$PQTMCFGPROT,W,1,1,5,1*3C",
	"$PAIR062,0,0*3E",
	"$PAIR062,1,0*3F",
	"$PAIR062,2,0*3C",
	"$PAIR062,3,10*0C",
	"$PAIR062,4,0*3A",
	"$PAIR062,5,0*3B",
	"$PAIR062,6,0*38",
	"$PAIR062,7,0*39",
	"$PAIR062,8,0*36",
	"$PAIR062,9,0*37",
	"$PQTMCFGMSGRATE,W,PQTMPVT,1,1*1C",
	"$PQTMCFGMSGRATE,W,PQTMVEL,1,1*11",
	"$PQTMCFGMSGRATE,W,PQTMEPE,1,2*1D",
	"$PQTMCFGMSGRATE,W,PQTMDOP,10,1*25",
	"$PQTMCFGMSGRATE,W,PQTMJAMMINGSTATUS,10,1*21",
	"$PAIR432,1*22",
	"$PAIR436,1*26",
	"$PAIR434,0*25",
	"$PAIR752,1,100*3A",
	"$PAIR752,2,100*39",
	"$PQTMCFGPPS,R,1*6A",
	"$PAIR391,1*2C",
	"$PAIR074,1*24",
	"$PAIR650,0*25",
	"$PAIR001,650,0*38",
	"$PQTMCFGRCVRMODE,R*32",
	"$PQTMCFGRCVRMODE,W,1*2A",
	"$PQTMCFGCNST,W,1,1,1,1,1,0*2A",
	"$PAIR062,0,1*3F",
	"$PAIR062,4,1*3B",
	"$PQTMSAVEPAR*5A",
	"$PQTMRESTOREPAR*13",
	"$PAIR007*3D",
};

static void checksums_match_the_document(void)
{
	char body[64], built[80];

	for (size_t i = 0; i < COUNT(documented); i++) {
		const char *line = documented[i];
		const char *star = strchr(line, '*');
		size_t n = (size_t)(star - line) - 1;
		int len;

		memcpy(body, &line[1], n);
		body[n] = '\0';
		len = pod_nmea_build(body, built, sizeof(built));
		test_current = line;
		CHECK(len > 0);
		CHECK(strncmp(built, line, strlen(line)) == 0);
		CHECK(strcmp(&built[strlen(line)], "\r\n") == 0);
	}
	test_current = "checksums_match_the_document";
}

/* The AA boot sequence, steps 2–4 of lc29h-protocolo.md, in order. */
static const char *const boot_lines[] = {
	"$PAIR382,1*2E",
	"$PAIR003*39",
	"$PAIR050,100*22",
	"$PAIR104,1*22",
	"$PAIR066,1,1,1,1,1,0*3B",
	"$PAIR080,0*2E",
	"$PAIR070,0*21",
	"$PAIR410,0*23",
	"$PAIR400,0*22",
	"$PQTMCFGPROT,W,1,1,1,5*3C",
	"$PAIR513*3D",
	"$PAIR002*38",
	"$PAIR062,0,0*3E",
	"$PAIR062,1,0*3F",
	"$PAIR062,2,0*3C",
	"$PAIR062,3,10*0C",
	"$PAIR062,4,0*3A",
	"$PAIR062,5,0*3B",
	"$PAIR062,6,0*38",
	"$PAIR062,7,0*39",
	"$PAIR062,8,0*36",
	"$PAIR062,9,0*37",
	"$PQTMCFGMSGRATE,W,PQTMPVT,1,1*1C",
	"$PQTMCFGMSGRATE,W,PQTMVEL,1,1*11",
	"$PQTMCFGMSGRATE,W,PQTMEPE,1,2*1D",
	"$PQTMCFGMSGRATE,W,PQTMDOP,10,1*25",
	"$PQTMCFGMSGRATE,W,PQTMJAMMINGSTATUS,10,1*21",
	"$PAIR432,1*22",
	"$PAIR436,1*26",
	"$PAIR434,0*25",
	"$PAIR752,1,100*3A",
	"$PQTMCFGPPS,R,1*6A",
	"$PAIR391,1*2C",
	"$PAIR074,1*24",
};

static void boot_sequence_is_the_documented_one(void)
{
	char built[80];
	uint32_t waited_after_off = 0;

	CHECK_EQ(pod_lc29h_aa_boot_len, COUNT(boot_lines));
	for (size_t i = 0; i < pod_lc29h_aa_boot_len && i < COUNT(boot_lines); i++) {
		pod_nmea_build(pod_lc29h_aa_boot[i].body, built, sizeof(built));
		test_current = boot_lines[i];
		CHECK(strncmp(built, boot_lines[i], strlen(boot_lines[i])) == 0);
		CHECK(pod_lc29h_aa_boot[i].timeout_ms > 0);
		if (strcmp(pod_lc29h_aa_boot[i].body, "PAIR003") == 0) {
			waited_after_off = pod_lc29h_aa_boot[i].delay_after_ms;
		}
	}
	test_current = "boot_sequence_is_the_documented_one";
	/* At least 2 s between $PAIR003 and $PAIR002. */
	CHECK(waited_after_off >= 2000);
	CHECK_EQ(pod_lc29h_enter_backup_len, 1);
	CHECK(strcmp(pod_lc29h_enter_backup[0].body, "PAIR650,0") == 0);
}

static void backup_exit_keeps_wakeup_high_10ms(void)
{
	int high_at = -1;
	uint32_t held = 0;

	for (size_t i = 0; i < pod_lc29h_backup_exit_actions_len; i++) {
		const struct pod_gnss_pin_action *a = &pod_lc29h_backup_exit_actions[i];

		if (a->step == POD_GNSS_STEP_WAKEUP_HIGH) {
			high_at = (int)i;
		} else if (high_at >= 0 && a->step == POD_GNSS_STEP_WAIT_MS) {
			held += a->ms;
		} else if (a->step == POD_GNSS_STEP_WAKEUP_RELEASE) {
			break;
		}
	}
	CHECK(high_at > 0);
	CHECK(pod_lc29h_backup_exit_actions[0].step == POD_GNSS_STEP_EN_HIGH);
	CHECK(held >= 10);
	/* A power cycle keeps VCC down at least 1 s. */
	CHECK(pod_lc29h_power_cycle_actions[1].step == POD_GNSS_STEP_WAIT_MS);
	CHECK(pod_lc29h_power_cycle_actions[1].ms >= 1000);
}

static void verify_and_responses(void)
{
	const char *body;
	size_t len;
	uint16_t id;
	int result;

	CHECK_EQ(pod_nmea_verify("$PAIR001,650,0*38\r\n", 19, &body, &len), POD_OK);
	CHECK_EQ(pod_pair_ack_parse(body, len, &id, &result), POD_OK);
	CHECK_EQ(id, 650);
	CHECK_EQ(result, POD_PAIR_OK);
	CHECK_EQ(pod_nmea_verify("$PAIR001,650,0*39", 17, &body, &len), POD_ERR_AUTH);
	CHECK_EQ(pod_nmea_verify("PAIR001,650,0*38", 16, &body, &len), POD_ERR_PARSE);
	CHECK_EQ(pod_nmea_verify("$PAIR001,650,0", 14, &body, &len), POD_ERR_PARSE);
	CHECK_EQ(pod_pqtm_response_parse("PQTMCFGPROT,OK", 14, "PQTMCFGPROT"), 0);
	CHECK_EQ(pod_pqtm_response_parse("PQTMCFGPROT,ERROR,3", 19, "PQTMCFGPROT"), 3);
	CHECK(pod_pqtm_response_parse("PQTMVERNO,OK", 12, "PQTMCFGPROT") < 0);
}

static void pvt_parse(void)
{
	char line[200];
	const char *body;
	size_t len;
	struct pod_gnss_pvt pvt;
	int n = pod_nmea_build("PQTMPVT,1,31075000,20221110,083737.000,,3,08,18,-34.51234565,"
			       "-58.5123456,20.100,1.200,3.000,-0.400,0.010,3.027,352.00,1.21,2.09",
			       line, sizeof(line));

	CHECK(n > 0);
	CHECK_EQ(pod_nmea_verify(line, (size_t)n, &body, &len), POD_OK);
	CHECK_EQ(pod_pqtmpvt_parse(body, len, &pvt), POD_OK);
	CHECK(pvt.valid);
	CHECK_EQ(pvt.tow_ms, 31075000);
	CHECK_EQ(pvt.gnss_time_ms, 1352104675000ll);
	CHECK_EQ(pvt.fix_mode, 3);
	CHECK_EQ(pvt.satellites_n, 8);
	CHECK_EQ(pvt.leap_s, 18);
	CHECK_EQ(pvt.lat_e7, -345123457); /* rounded half away from zero */
	CHECK_EQ(pvt.lon_e7, -585123456);
	CHECK_EQ(pvt.height_ellipsoid_mm, 21300);
	CHECK_EQ(pvt.vel_north_mm_s, 3000);
	CHECK_EQ(pvt.vel_east_mm_s, -400);
	CHECK_EQ(pvt.vel_down_mm_s, 10);
	CHECK_EQ(pvt.ground_speed_mm_s, 3027);
	CHECK_EQ(pvt.heading_centi_deg, 35200);
	CHECK_EQ(pvt.h_acc_mm, UINT32_MAX);

	n = pod_nmea_build("PQTMVEL,1,083737.000,3.000,-0.400,0.010,3.027,3.027,352.00,0.120,0.150,"
			   "1.50",
			   line, sizeof(line));
	CHECK_EQ(pod_nmea_verify(line, (size_t)n, &body, &len), POD_OK);
	CHECK_EQ(pod_pqtmvel_parse(body, len, &pvt), POD_OK);
	CHECK_EQ(pvt.speed_acc_mm_s, 120);
	n = pod_nmea_build("PQTMEPE,2,1.000,1.100,2.100,1.400,2.500", line, sizeof(line));
	CHECK_EQ(pod_nmea_verify(line, (size_t)n, &body, &len), POD_OK);
	CHECK_EQ(pod_pqtmepe_parse(body, len, &pvt), POD_OK);
	CHECK_EQ(pvt.h_acc_mm, 1400);
	CHECK_EQ(pvt.v_acc_mm, 2100);

	/* No fix: empty fields are fine and the solution is not valid. */
	n = pod_nmea_build("PQTMPVT,1,,,,,0,00,18,,,,,,,,,,,", line, sizeof(line));
	CHECK_EQ(pod_nmea_verify(line, (size_t)n, &body, &len), POD_OK);
	CHECK_EQ(pod_pqtmpvt_parse(body, len, &pvt), POD_OK);
	CHECK(!pvt.valid);
	/* Garbage in a numeric field. */
	n = pod_nmea_build("PQTMPVT,1,31075000,20221110,083737.000,,3,08,18,-3x.5,-58.5,20.1,1.2,"
			   "3.0,-0.4,0.0,3.0,352.0,1.2,2.0",
			   line, sizeof(line));
	CHECK_EQ(pod_nmea_verify(line, (size_t)n, &body, &len), POD_OK);
	CHECK_EQ(pod_pqtmpvt_parse(body, len, &pvt), POD_ERR_PARSE);
}

static void gps_time(void)
{
	/* GPS epoch itself, and 18 leap seconds later in 2017. */
	CHECK_EQ(pod_gps_ms_from_utc(19800106, 0, 0), 0);
	CHECK_EQ(pod_gps_ms_from_utc(20170101, 0, 18), (1483228800000ll - 315964800000ll) + 18000);
}

struct stream_counts {
	int nmea;
	int rtcm;
	size_t rtcm_len;
};

static void on_nmea(void *ctx, const char *line, size_t len)
{
	struct stream_counts *c = ctx;
	const char *body;
	size_t body_len;

	if (pod_nmea_verify(line, len, &body, &body_len) == POD_OK) {
		c->nmea++;
	}
}

static void on_rtcm(void *ctx, const uint8_t *frame, size_t len)
{
	struct stream_counts *c = ctx;

	(void)frame;
	c->rtcm++;
	c->rtcm_len = len;
}

static void stream_split(void)
{
	static struct pod_gnss_stream s;
	struct stream_counts counts = {0};
	uint8_t frame[9];
	const char *nmea = "$PAIR001,650,0*38\r\n";

	CHECK_EQ(pod_crc24q((const uint8_t *)"123456789", 9), 0xCDE703);
	hex_decode("d3000301020332ae83", frame, sizeof(frame));
	pod_gnss_stream_init(&s, on_nmea, on_rtcm, &counts);
	pod_gnss_stream_feed(&s, (const uint8_t *)nmea, strlen(nmea));
	pod_gnss_stream_feed(&s, frame, 4); /* split across two UART chunks */
	pod_gnss_stream_feed(&s, &frame[4], 5);
	pod_gnss_stream_feed(&s, (const uint8_t *)"xx", 2);
	pod_gnss_stream_feed(&s, (const uint8_t *)nmea, strlen(nmea));
	frame[8] ^= 1;
	pod_gnss_stream_feed(&s, frame, sizeof(frame));
	CHECK_EQ(counts.nmea, 2);
	CHECK_EQ(counts.rtcm, 1);
	CHECK_EQ(counts.rtcm_len, 9);
	CHECK_EQ(s.bad_crc_frames, 1);
	CHECK_EQ(s.dropped_bytes, 2);
}

void run_gnss_tests(void)
{
	RUN(checksums_match_the_document);
	RUN(boot_sequence_is_the_documented_one);
	RUN(backup_exit_keeps_wakeup_high_10ms);
	RUN(verify_and_responses);
	RUN(pvt_parse);
	RUN(gps_time);
	RUN(stream_split);
}
