/*
 * LoRa frames against packages/pod-protocol/fixtures/v1/vectors.json.
 */
#include <string.h>

#include "fixtures_v1.h"
#include "pod/errors.h"
#include "pod/radio.h"
#include "test.h"

#define COUNT(a) (sizeof(a) / sizeof((a)[0]))

static void kdf_vectors(void)
{
	uint8_t master[32], id[8], info[POD_KDF_INFO_MAX], key[16];

	hex_decode(FX_MASTER_KEY_HEX, master, sizeof(master));
	for (size_t i = 0; i < COUNT(fx_kdf); i++) {
		size_t id_len = hex_decode(fx_kdf[i].id_hex, id, sizeof(id));
		int n = pod_kdf_info(fx_kdf[i].label, id, id_len, fx_kdf[i].epoch, info, sizeof(info));

		CHECK(n > 0);
		CHECK_HEX(info, (size_t)n, fx_kdf[i].info_hex);
		CHECK_EQ(pod_derive_key(master, fx_kdf[i].label, id, id_len, fx_kdf[i].epoch, key),
			 POD_OK);
		CHECK_HEX(key, 16, fx_kdf[i].key_hex);
	}
}

static void uplink_vectors(void)
{
	uint8_t key[16];

	hex_decode(FX_LINK_KEY_HEX, key, sizeof(key));
	for (size_t i = 0; i < COUNT(fx_uplink); i++) {
		const struct fx_uplink *u = &fx_uplink[i];
		struct pod_uplink_counters c = {
			.network_id = FX_NETWORK_ID,
			.pod_short_id = FX_POD_SHORT_ID,
			.key_id = FX_KEY_ID,
			.boot_counter = u->boot_counter,
			.frame_number = u->frame_number,
		};
		uint8_t nonce[13], header[POD_UPLINK_HEADER_LEN], pt[64], packet[64];
		bool with_position = u->type == POD_MSG_LIVE_SUMMARY;
		const struct pod_live_summary *s = u->type == POD_MSG_SLOT_REQUEST ? NULL : &u->summary;
		int n;

		test_current = u->name;
		pod_link_nonce(u->boot_counter, u->frame_number, POD_LINK_DIRECTION_UPLINK, nonce);
		CHECK_HEX(nonce, 13, u->nonce_hex);
		CHECK_EQ(pod_uplink_header_encode(u->type, &c, header), POD_OK);
		CHECK_HEX(header, sizeof(header), u->header_hex);
		if (s != NULL) {
			n = pod_live_payload_encode(s, with_position, pt, sizeof(pt));
			CHECK(n > 0);
			CHECK_HEX(pt, n > 0 ? (size_t)n : 0, u->plaintext_hex);
		}
		n = pod_uplink_seal(key, &c, s, with_position, packet, sizeof(packet));
		CHECK(n > 0);
		CHECK_HEX(packet, n > 0 ? (size_t)n : 0, u->packet_hex);
	}
}

static void uplink_rejects_out_of_range(void)
{
	struct pod_live_summary s;
	uint8_t pt[64];

	memset(&s, 0, sizeof(s));
	s.battery_pct = 101;
	CHECK_EQ(pod_live_payload_encode(&s, true, pt, sizeof(pt)), POD_ERR_RANGE);
	s.battery_pct = 50;
	s.session_distance_dm = 0x1000000;
	CHECK_EQ(pod_live_payload_encode(&s, true, pt, sizeof(pt)), POD_ERR_RANGE);
	s.session_distance_dm = 0;
	s.seconds[0].has_position = true;
	CHECK_EQ(pod_live_payload_encode(&s, false, pt, sizeof(pt)), POD_ERR_RANGE);
	s.seconds[0].x_dm = POD_NO_POSITION_DM;
	CHECK_EQ(pod_live_payload_encode(&s, true, pt, sizeof(pt)), POD_ERR_RANGE);
	CHECK_EQ(pod_live_payload_encode(&s, true, pt, 10), POD_ERR_LENGTH);
}

static void beacon_vectors(void)
{
	uint8_t key[16], packet[64], nonce[13];

	hex_decode(FX_BEACON_KEY_HEX, key, sizeof(key));
	for (size_t i = 0; i < COUNT(fx_beacon); i++) {
		const struct fx_beacon *c = &fx_beacon[i];
		const struct pod_beacon *e = &c->beacon;
		struct pod_beacon got;
		size_t n = hex_decode(c->packet_hex, packet, sizeof(packet));

		test_current = c->name;
		pod_downlink_nonce(e->network_id, e->gnss_time_s, packet[0], 0, nonce);
		CHECK_HEX(nonce, 13, c->nonce_hex);
		CHECK_EQ(pod_beacon_open(key, packet, n, &got), POD_OK);
		CHECK_EQ(got.network_id, e->network_id);
		CHECK_EQ(got.gnss_time_s, e->gnss_time_s);
		CHECK_EQ(got.key_id, e->key_id);
		CHECK_EQ(got.session_open, e->session_open);
		CHECK_EQ(got.led_mode, e->led_mode);
		CHECK_EQ(got.channel_plan_id, e->channel_plan_id);
		CHECK_EQ(got.config_version, e->config_version);
		CHECK_EQ(got.session_seq, e->session_seq);
		CHECK_EQ(got.session_transition_gnss_s, e->session_transition_gnss_s);
		CHECK_EQ(got.grants_n, e->grants_n);
		for (uint8_t g = 0; g < e->grants_n && g < got.grants_n; g++) {
			CHECK_EQ(got.grants[g].pod_short_id, e->grants[g].pod_short_id);
			CHECK_EQ(got.grants[g].release, e->grants[g].release);
			CHECK_EQ(got.grants[g].channel, e->grants[g].channel);
			CHECK_EQ(got.grants[g].slot, e->grants[g].slot);
		}
		/* Any flipped bit (header is AAD, then body, then MIC) fails the MIC. */
		packet[1] ^= 0x01;
		CHECK_EQ(pod_beacon_open(key, packet, n, &got), POD_ERR_AUTH);
		packet[1] ^= 0x01;
		packet[n - 1] ^= 0x80;
		CHECK_EQ(pod_beacon_open(key, packet, n, &got), POD_ERR_AUTH);
		packet[n - 1] ^= 0x80;
		/* Wrong version nibble, odd GNSS second, truncated. */
		packet[0] = (uint8_t)((2u << 4) | POD_MSG_BEACON);
		CHECK_EQ(pod_beacon_open(key, packet, n, &got), POD_ERR_VERSION);
		packet[0] = POD_TYPE_BYTE(POD_MSG_BEACON);
		CHECK_EQ(pod_beacon_open(key, packet, n - 1, &got), POD_ERR_LENGTH);
	}
}

static void rtcm_vectors(void)
{
	uint8_t key[16], packet[300], nonce[13];

	hex_decode(FX_BEACON_KEY_HEX, key, sizeof(key));
	for (size_t i = 0; i < COUNT(fx_rtcm); i++) {
		const struct fx_rtcm *c = &fx_rtcm[i];
		struct pod_rtcm_fragment got;
		size_t n = hex_decode(c->packet_hex, packet, sizeof(packet));

		test_current = c->name;
		pod_downlink_nonce(c->network_id, c->gnss_time_s, packet[0], c->fragment_index, nonce);
		CHECK_HEX(nonce, 13, c->nonce_hex);
		CHECK_EQ(pod_rtcm_fragment_open(key, packet, n, &got), POD_OK);
		CHECK_EQ(got.network_id, c->network_id);
		CHECK_EQ(got.gnss_time_s, c->gnss_time_s);
		CHECK_EQ(got.key_id, c->key_id);
		CHECK_EQ(got.fragment_index, c->fragment_index);
		CHECK_EQ(got.fragment_count, c->fragment_count);
		CHECK_HEX(got.data, got.data_len, c->data_hex);
		packet[9] = 0; /* fragment count 0 */
		CHECK_EQ(pod_rtcm_fragment_open(key, packet, n, &got), POD_ERR_RANGE);
	}
}

static void link_counter_rule(void)
{
	uint32_t boot = 70000;
	uint16_t frame = 0xfffe;
	bool persist;

	CHECK_EQ(pod_next_link_counter(&boot, &frame, &persist), POD_OK);
	CHECK_EQ(frame, 0xffff);
	CHECK(!persist);
	CHECK_EQ(pod_next_link_counter(&boot, &frame, &persist), POD_OK);
	CHECK_EQ(boot, 70001);
	CHECK_EQ(frame, 0);
	CHECK(persist);
	boot = 0xffffffffu;
	frame = 0xffff;
	CHECK_EQ(pod_next_link_counter(&boot, &frame, &persist), POD_ERR_EXHAUSTED);
}

void run_radio_tests(void)
{
	RUN(kdf_vectors);
	RUN(uplink_vectors);
	RUN(uplink_rejects_out_of_range);
	RUN(beacon_vectors);
	RUN(rtcm_vectors);
	RUN(link_counter_rule);
}
