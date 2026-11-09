/*
 * LoRa frame format v1 (see pod/radio.h). Every check mirrors the TypeScript
 * reference in packages/pod-protocol/src (uplink.ts, downlink.ts, nonce.ts,
 * counters.ts, crypto.ts).
 */
#include <string.h>

#include "pod/bytes.h"
#include "pod/crypto.h"
#include "pod/errors.h"
#include "pod/radio.h"

void pod_link_nonce(uint32_t boot_counter, uint16_t frame_number, uint8_t direction,
		    uint8_t out[13])
{
	struct pod_writer w;

	memset(out, 0, 13);
	pod_writer_init(&w, out, 13);
	pod_put_u32(&w, boot_counter);
	pod_put_u16(&w, frame_number);
	pod_put_u8(&w, direction);
}

void pod_downlink_nonce(uint16_t network_id, uint32_t gnss_time_s, uint8_t type_byte,
			uint8_t fragment_index, uint8_t out[13])
{
	struct pod_writer w;

	memset(out, 0, 13);
	pod_writer_init(&w, out, 13);
	pod_put_u16(&w, network_id);
	pod_put_u32(&w, gnss_time_s);
	pod_put_u8(&w, type_byte);
	pod_put_u8(&w, fragment_index);
}

int pod_uplink_header_encode(uint8_t type_code, const struct pod_uplink_counters *c,
			     uint8_t out[POD_UPLINK_HEADER_LEN])
{
	struct pod_writer w;

	if (type_code != POD_MSG_LIVE_SUMMARY && type_code != POD_MSG_LIVE_SUMMARY_NO_POSITION &&
	    type_code != POD_MSG_SLOT_REQUEST) {
		return POD_ERR_TYPE;
	}
	pod_writer_init(&w, out, POD_UPLINK_HEADER_LEN);
	pod_put_u8(&w, POD_TYPE_BYTE(type_code));
	pod_put_u16(&w, c->network_id);
	pod_put_u16(&w, c->pod_short_id);
	pod_put_u8(&w, c->key_id);
	pod_put_u16(&w, c->boot_counter & 0xffffu);
	pod_put_u16(&w, c->frame_number);
	return w.overflow ? POD_ERR_LENGTH : POD_OK;
}

static int check_coordinate(int16_t v)
{
	/* −32768 is the "no position" sentinel. */
	return v == POD_NO_POSITION_DM ? POD_ERR_RANGE : POD_OK;
}

int pod_live_payload_encode(const struct pod_live_summary *s, bool with_position, uint8_t *out,
			    size_t cap)
{
	struct pod_writer w;
	size_t expected = with_position ? POD_LIVE_PAYLOAD_LEN : POD_LIVE_PAYLOAD_NO_POSITION_LEN;
	uint16_t status;

	if (cap < expected) {
		return POD_ERR_LENGTH;
	}
	if (s->battery_pct > 100 && s->battery_pct != POD_BATTERY_UNKNOWN) {
		return POD_ERR_RANGE;
	}
	if ((unsigned int)s->fix_quality > POD_FIX_RTK_FIXED) {
		return POD_ERR_RANGE;
	}
	if (s->session_distance_dm > 0xffffffu || s->accel_load_centi_au > 0xffffffu) {
		return POD_ERR_RANGE;
	}
	status = (uint16_t)(((uint16_t)s->battery_pct << 9) | ((s->vest_on ? 1u : 0u) << 8) |
			    ((unsigned int)s->fix_quality << 5));

	pod_writer_init(&w, out, cap);
	pod_put_u16(&w, status);
	pod_put_u24(&w, s->session_distance_dm);
	for (unsigned int i = 0; i < 4; i++) {
		pod_put_u16(&w, s->speed_band_distance_m[i]);
	}
	pod_put_u16(&w, s->accelerations_n);
	pod_put_u16(&w, s->decelerations_n);
	pod_put_u24(&w, s->accel_load_centi_au);
	pod_put_u16(&w, s->impacts_n);
	for (unsigned int i = 0; i < 2; i++) {
		pod_put_u16(&w, s->seconds[i].vmax_cm_s);
	}
	for (unsigned int i = 0; i < 2; i++) {
		pod_put_u8(&w, s->seconds[i].distance_dm);
	}
	for (unsigned int i = 0; i < 2; i++) {
		const struct pod_live_second *sec = &s->seconds[i];

		if (!with_position) {
			if (sec->has_position) {
				return POD_ERR_RANGE;
			}
			continue;
		}
		if (!sec->has_position) {
			pod_put_i16(&w, POD_NO_POSITION_DM);
			pod_put_i16(&w, POD_NO_POSITION_DM);
			continue;
		}
		if (check_coordinate(sec->x_dm) != POD_OK || check_coordinate(sec->y_dm) != POD_OK) {
			return POD_ERR_RANGE;
		}
		pod_put_i16(&w, sec->x_dm);
		pod_put_i16(&w, sec->y_dm);
	}
	pod_put_u8(&w, s->config_version);
	if (w.overflow || w.len != expected) {
		return POD_ERR_LENGTH;
	}
	return (int)w.len;
}

int pod_uplink_seal(const uint8_t link_key[16], const struct pod_uplink_counters *c,
		    const struct pod_live_summary *summary, bool with_position, uint8_t *out,
		    size_t cap)
{
	uint8_t type;
	uint8_t nonce[13];
	uint8_t plaintext[POD_LIVE_PAYLOAD_LEN];
	int pt_len = 0;
	int rc;

	if (pod_key_is_zero(link_key, 16)) {
		return POD_ERR_STATE; /* not provisioned: never transmit */
	}
	if (summary == NULL) {
		type = POD_MSG_SLOT_REQUEST;
	} else {
		type = with_position ? POD_MSG_LIVE_SUMMARY : POD_MSG_LIVE_SUMMARY_NO_POSITION;
		pt_len = pod_live_payload_encode(summary, with_position, plaintext,
						 sizeof(plaintext));
		if (pt_len < 0) {
			return pt_len;
		}
	}
	if (cap < (size_t)(POD_UPLINK_HEADER_LEN + pt_len + POD_CCM_TAG_LEN)) {
		return POD_ERR_LENGTH;
	}
	rc = pod_uplink_header_encode(type, c, out);
	if (rc != POD_OK) {
		return rc;
	}
	pod_link_nonce(c->boot_counter, c->frame_number, POD_LINK_DIRECTION_UPLINK, nonce);
	rc = pod_aes128_ccm_seal(link_key, nonce, out, POD_UPLINK_HEADER_LEN, plaintext,
				 (size_t)pt_len, &out[POD_UPLINK_HEADER_LEN], POD_CCM_TAG_LEN);
	if (rc != POD_OK) {
		return rc;
	}
	return POD_UPLINK_HEADER_LEN + pt_len + POD_CCM_TAG_LEN;
}

/* Clear part shared by every downlink frame (first 8 B). */
static int downlink_header(const uint8_t *packet, size_t len, uint8_t expected_type,
			   uint16_t *network_id, uint32_t *gnss_time_s, uint8_t *key_id)
{
	if (len < POD_BEACON_HEADER_LEN) {
		return POD_ERR_LENGTH;
	}
	if ((packet[0] >> 4) != POD_PROTOCOL_VERSION) {
		return POD_ERR_VERSION;
	}
	if ((packet[0] & 0x0fu) != expected_type) {
		return POD_ERR_TYPE;
	}
	*network_id = pod_get_u16(&packet[1]);
	*gnss_time_s = pod_get_u32(&packet[3]);
	*key_id = packet[7];
	if ((*gnss_time_s % 2u) != 0) {
		return POD_ERR_RANGE;
	}
	return POD_OK;
}

int pod_beacon_open(const uint8_t beacon_key[16], const uint8_t *packet, size_t len,
		    struct pod_beacon *out)
{
	const size_t minimum = POD_BEACON_HEADER_LEN + POD_BEACON_FIXED_BODY_LEN + POD_CCM_TAG_LEN;
	uint8_t body[POD_BEACON_FIXED_BODY_LEN + POD_MAX_GRANTS_PER_BEACON * POD_SLOT_GRANT_LEN];
	uint8_t nonce[13];
	size_t body_len;
	uint8_t flags;
	uint8_t count;
	int rc;

	memset(out, 0, sizeof(*out));
	rc = downlink_header(packet, len, POD_MSG_BEACON, &out->network_id, &out->gnss_time_s,
			     &out->key_id);
	if (rc != POD_OK) {
		return rc;
	}
	if (len < minimum || (len - minimum) % POD_SLOT_GRANT_LEN != 0) {
		return POD_ERR_LENGTH;
	}
	body_len = len - POD_BEACON_HEADER_LEN - POD_CCM_TAG_LEN;
	if (body_len > sizeof(body)) {
		return POD_ERR_RANGE;
	}
	pod_downlink_nonce(out->network_id, out->gnss_time_s, packet[0], 0, nonce);
	rc = pod_aes128_ccm_open(beacon_key, nonce, packet, POD_BEACON_HEADER_LEN,
				 &packet[POD_BEACON_HEADER_LEN], len - POD_BEACON_HEADER_LEN, body,
				 POD_CCM_TAG_LEN);
	if (rc != POD_OK) {
		return rc;
	}
	flags = body[0];
	if ((flags & 0xf8u) != 0) {
		return POD_ERR_RESERVED;
	}
	if (((flags >> 1) & 0x03u) == 3u) {
		return POD_ERR_RANGE;
	}
	out->session_open = (flags & 1u) != 0;
	out->led_mode = (enum pod_led_mode)((flags >> 1) & 0x03u);
	out->channel_plan_id = body[1];
	out->config_version = body[2];
	out->session_seq = body[3];
	out->session_transition_gnss_s = pod_get_u32(&body[4]);
	count = body[8];
	if (count > POD_MAX_GRANTS_PER_BEACON) {
		return POD_ERR_RANGE;
	}
	if (body_len - POD_BEACON_FIXED_BODY_LEN != (size_t)count * POD_SLOT_GRANT_LEN) {
		return POD_ERR_LENGTH;
	}
	for (uint8_t i = 0; i < count; i++) {
		const uint8_t *g = &body[POD_BEACON_FIXED_BODY_LEN + i * POD_SLOT_GRANT_LEN];
		uint8_t byte = g[2];

		if ((byte & 0x0fu) == POD_CONTENTION_SLOT) {
			return POD_ERR_RANGE;
		}
		out->grants[i].pod_short_id = pod_get_u16(g);
		out->grants[i].release = (byte & 0x80u) != 0;
		out->grants[i].channel = (uint8_t)((byte >> 4) & 0x07u);
		out->grants[i].slot = (uint8_t)(byte & 0x0fu);
	}
	out->grants_n = count;
	return POD_OK;
}

int pod_rtcm_fragment_open(const uint8_t beacon_key[16], const uint8_t *packet, size_t len,
			   struct pod_rtcm_fragment *out)
{
	uint8_t nonce[13];
	size_t body_len;
	int rc;

	memset(out, 0, sizeof(*out));
	rc = downlink_header(packet, len, POD_MSG_RTCM_FRAGMENT, &out->network_id,
			     &out->gnss_time_s, &out->key_id);
	if (rc != POD_OK) {
		return rc;
	}
	if (len < POD_RTCM_HEADER_LEN + POD_CCM_TAG_LEN + 1) {
		return POD_ERR_LENGTH;
	}
	body_len = len - POD_RTCM_HEADER_LEN - POD_CCM_TAG_LEN;
	if (body_len > POD_MAX_RTCM_FRAGMENT_BODY_LEN) {
		return POD_ERR_LENGTH;
	}
	out->fragment_index = packet[8];
	out->fragment_count = packet[9];
	if (out->fragment_count == 0 || out->fragment_index >= out->fragment_count) {
		return POD_ERR_RANGE;
	}
	pod_downlink_nonce(out->network_id, out->gnss_time_s, packet[0], out->fragment_index,
			   nonce);
	rc = pod_aes128_ccm_open(beacon_key, nonce, packet, POD_RTCM_HEADER_LEN,
				 &packet[POD_RTCM_HEADER_LEN], len - POD_RTCM_HEADER_LEN, out->data,
				 POD_CCM_TAG_LEN);
	if (rc != POD_OK) {
		return rc;
	}
	out->data_len = (uint8_t)body_len;
	return POD_OK;
}

int pod_next_link_counter(uint32_t *boot_counter, uint16_t *frame_number, bool *persist)
{
	*persist = false;
	if (*frame_number < 0xffffu) {
		(*frame_number)++;
		return POD_OK;
	}
	if (*boot_counter == 0xffffffffu) {
		return POD_ERR_EXHAUSTED;
	}
	(*boot_counter)++;
	*frame_number = 0;
	*persist = true;
	return POD_OK;
}

#define KDF_PREFIX "sport-performance/pod-kdf/v1/"

int pod_kdf_info(const char *label, const uint8_t *id, size_t id_len, uint8_t epoch,
		 uint8_t *out, size_t cap)
{
	struct pod_writer w;

	if (id_len == 0 || id_len > 0xff) {
		return POD_ERR_RANGE;
	}
	pod_writer_init(&w, out, cap);
	pod_put_raw(&w, (const uint8_t *)KDF_PREFIX, strlen(KDF_PREFIX));
	pod_put_raw(&w, (const uint8_t *)label, strlen(label));
	pod_put_u8(&w, 0x00);
	pod_put_u8(&w, (uint32_t)id_len);
	pod_put_raw(&w, id, id_len);
	pod_put_u8(&w, epoch);
	return w.overflow ? POD_ERR_LENGTH : (int)w.len;
}

int pod_derive_key(const uint8_t master_key[32], const char *label, const uint8_t *id,
		   size_t id_len, uint8_t epoch, uint8_t out[16])
{
	uint8_t info[POD_KDF_INFO_MAX];
	int info_len = pod_kdf_info(label, id, id_len, epoch, info, sizeof(info));

	if (info_len < 0) {
		return info_len;
	}
	return pod_hkdf_sha256(master_key, 32, info, (size_t)info_len, out, 16);
}
