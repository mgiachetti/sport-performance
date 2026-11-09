/*
 * NAND log format v1 (see pod/log.h). Mirrors packages/pod-protocol/src/log.
 */
#include <string.h>

#include "pod/bytes.h"
#include "pod/crypto.h"
#include "pod/errors.h"
#include "pod/log.h"

/* ------------------------------------------------------------------------ */
/* Records. */

#define IMU_FIXED_LEN 25
#define BARO_FIXED_LEN 11
#define BARO_SAMPLE_LEN 5
#define GNSS_RAW_FIXED_LEN 7
#define FIRMWARE_FIXED_LEN 14
#define MAX_TICK 0xFFFFFFFFFFFFull

static unsigned int imu_axes(uint8_t channel)
{
	return channel == POD_IMU_CH_ACCEL_GYRO ? 6u : 3u;
}

static int body_length(const struct pod_log_record *r, size_t *len)
{
	switch (r->type) {
	case POD_REC_FIRMWARE_INFO: {
		size_t n = r->u.firmware_info.gnss_firmware ? strlen(r->u.firmware_info.gnss_firmware)
							    : 0;

		if (n > 64) {
			return POD_ERR_RANGE;
		}
		*len = FIRMWARE_FIXED_LEN + n;
		return POD_OK;
	}
	case POD_REC_CONFIG_APPLIED:
		*len = 16;
		return POD_OK;
	case POD_REC_GNSS_PVT:
		*len = 36;
		return POD_OK;
	case POD_REC_GNSS_RAW:
		*len = GNSS_RAW_FIXED_LEN + (size_t)r->u.gnss_raw.data_len;
		return POD_OK;
	case POD_REC_IMU_BATCH:
		if (r->u.imu_batch.channel != POD_IMU_CH_ACCEL_GYRO &&
		    r->u.imu_batch.channel != POD_IMU_CH_HIGH_G) {
			return POD_ERR_RANGE;
		}
		*len = IMU_FIXED_LEN +
		       (size_t)r->u.imu_batch.samples_n * imu_axes(r->u.imu_batch.channel) * 2u;
		return POD_OK;
	case POD_REC_BARO_BATCH:
		*len = BARO_FIXED_LEN + (size_t)r->u.baro_batch.samples_n * BARO_SAMPLE_LEN;
		return POD_OK;
	case POD_REC_TIME_ANCHOR:
		*len = 14;
		return POD_OK;
	case POD_REC_SENSOR_SYNC:
		*len = 7;
		return POD_OK;
	case POD_REC_SEGMENT_MARKER:
		*len = 6;
		return POD_OK;
	case POD_REC_HEALTH:
		*len = 15;
		return POD_OK;
	case POD_REC_RADIO_TX:
		*len = 8;
		return POD_OK;
	case POD_REC_EVENT:
		*len = 6;
		return POD_OK;
	default:
		if (r->type == 0x00 || r->type == 0xff) {
			return POD_ERR_TYPE;
		}
		*len = r->u.raw.body_len;
		return POD_OK;
	}
}

int pod_record_length(const struct pod_log_record *r)
{
	size_t len;
	int rc = body_length(r, &len);

	if (rc != POD_OK) {
		return rc;
	}
	if (len > 0xffffu) {
		return POD_ERR_RANGE;
	}
	return (int)(POD_RECORD_HEADER_LEN + len);
}

static int encode_body(const struct pod_log_record *r, struct pod_writer *w)
{
	switch (r->type) {
	case POD_REC_FIRMWARE_INFO: {
		const struct pod_rec_firmware_info *f = &r->u.firmware_info;
		size_t n = f->gnss_firmware ? strlen(f->gnss_firmware) : 0;

		pod_put_u8(w, f->major);
		pod_put_u8(w, f->minor);
		pod_put_u16(w, f->patch);
		pod_put_u32(w, f->build_id);
		pod_put_u8(w, f->hardware_revision);
		pod_put_u16(w, f->algorithm_version);
		pod_put_u8(w, f->radio_protocol_version);
		pod_put_u8(w, f->log_format_version);
		pod_put_u8(w, (uint32_t)n);
		pod_put_raw(w, (const uint8_t *)f->gnss_firmware, n);
		return POD_OK;
	}
	case POD_REC_CONFIG_APPLIED: {
		const struct pod_rec_config_applied *c = &r->u.config_applied;

		if ((c->constellations >> 6) != 0 || (c->bands >> 2) != 0) {
			return POD_ERR_RESERVED;
		}
		pod_put_u32(w, c->config_version);
		pod_put_raw(w, c->config_hash, 8);
		pod_put_u8(w, c->gnss_pvt_rate_hz);
		pod_put_u8(w, c->gnss_raw_rate_hz);
		pod_put_u8(w, c->constellations);
		pod_put_u8(w, c->bands);
		return POD_OK;
	}
	case POD_REC_GNSS_PVT: {
		const struct pod_rec_gnss_pvt *p = &r->u.gnss_pvt;

		if (p->gnss_time_ms >= POD_LOG_NO_GNSS_TIME_MS || p->lat_e7 < -900000000 ||
		    p->lat_e7 > 900000000 || p->lon_e7 < -1800000000 || p->lon_e7 > 1800000000 ||
		    p->fix_quality > 6 ||
		    (p->heading_centi_deg != POD_LOG_UNKNOWN_U16 && p->heading_centi_deg > 35999)) {
			return POD_ERR_RANGE;
		}
		pod_put_u48(w, p->gnss_time_ms);
		pod_put_i32(w, p->lat_e7);
		pod_put_i32(w, p->lon_e7);
		pod_put_i32(w, p->height_ellipsoid_mm);
		pod_put_i16(w, p->vel_north_mm_s);
		pod_put_i16(w, p->vel_east_mm_s);
		pod_put_i16(w, p->vel_down_mm_s);
		pod_put_u16(w, p->ground_speed_mm_s);
		pod_put_u16(w, p->heading_centi_deg);
		pod_put_u16(w, p->h_acc_mm);
		pod_put_u16(w, p->v_acc_mm);
		pod_put_u16(w, p->speed_acc_mm_s);
		pod_put_u8(w, p->fix_quality);
		pod_put_u8(w, p->satellites_n);
		return POD_OK;
	}
	case POD_REC_GNSS_RAW: {
		const struct pod_rec_gnss_raw *g = &r->u.gnss_raw;

		if (g->format < POD_RAW_RTCM3_MSM7 || g->format > POD_RAW_QUECTEL ||
		    g->gnss_time_ms > POD_LOG_NO_GNSS_TIME_MS) {
			return POD_ERR_RANGE;
		}
		pod_put_u8(w, g->format);
		pod_put_u48(w, g->gnss_time_ms);
		pod_put_raw(w, g->data, g->data_len);
		return POD_OK;
	}
	case POD_REC_IMU_BATCH: {
		const struct pod_rec_imu_batch *b = &r->u.imu_batch;
		size_t values = (size_t)b->samples_n * imu_axes(b->channel);

		if (b->sensor < POD_IMU_LSM6DSV320X || b->sensor > POD_IMU_ADXL372 ||
		    (b->channel == POD_IMU_CH_HIGH_G && b->gyro_range_dps != 0)) {
			return POD_ERR_RANGE;
		}
		pod_put_u8(w, b->sensor);
		pod_put_u8(w, b->channel);
		pod_put_u8(w, (b->fifo_overrun ? 0x01u : 0u) | (b->impact_burst ? 0x02u : 0u));
		pod_put_u16(w, b->accel_range_g);
		pod_put_u16(w, b->gyro_range_dps);
		pod_put_u32(w, b->odr_milli_hz);
		pod_put_u32(w, b->sensor_tick_period_ns);
		pod_put_u32(w, b->first_sensor_timestamp);
		pod_put_u32(w, b->last_sensor_timestamp);
		pod_put_u16(w, b->samples_n);
		for (size_t i = 0; i < values; i++) {
			pod_put_i16(w, b->samples[i]);
		}
		return POD_OK;
	}
	case POD_REC_BARO_BATCH: {
		const struct pod_rec_baro_batch *b = &r->u.baro_batch;

		if (b->sensor < POD_BARO_BMP581 || b->sensor > POD_BARO_DPS368) {
			return POD_ERR_RANGE;
		}
		pod_put_u8(w, b->sensor);
		pod_put_u32(w, b->odr_milli_hz);
		pod_put_u32(w, b->last_sample_delta_ticks);
		pod_put_u16(w, b->samples_n);
		for (uint16_t i = 0; i < b->samples_n; i++) {
			if (b->samples[i].pressure_centi_pa > 0xffffffu) {
				return POD_ERR_RANGE;
			}
			pod_put_u24(w, b->samples[i].pressure_centi_pa);
			pod_put_i16(w, b->samples[i].temperature_centi_c);
		}
		return POD_OK;
	}
	case POD_REC_TIME_ANCHOR: {
		const struct pod_rec_time_anchor *a = &r->u.time_anchor;

		if (a->source < POD_ANCHOR_GNSS_PPS || a->source > POD_ANCHOR_DOCK ||
		    a->sub_tick_ns > 30517 || a->gnss_time_ms >= POD_LOG_NO_GNSS_TIME_MS) {
			return POD_ERR_RANGE;
		}
		pod_put_u8(w, a->source);
		pod_put_u16(w, a->sub_tick_ns);
		pod_put_u48(w, a->gnss_time_ms);
		pod_put_u32(w, a->uncertainty_us);
		pod_put_u8(w, a->gps_utc_offset_s);
		return POD_OK;
	}
	case POD_REC_SENSOR_SYNC: {
		const struct pod_rec_sensor_sync *s = &r->u.sensor_sync;

		if (s->sensor < 1 || s->sensor > 3 || s->sub_tick_ns > 30517) {
			return POD_ERR_RANGE;
		}
		pod_put_u8(w, s->sensor);
		pod_put_u16(w, s->sub_tick_ns);
		pod_put_u32(w, s->sensor_timestamp);
		return POD_OK;
	}
	case POD_REC_SEGMENT_MARKER: {
		const struct pod_rec_segment_marker *m = &r->u.segment_marker;

		if (m->kind < POD_MARK_RECORDING_START || m->kind > POD_MARK_STAFF_SESSION_CLOSE) {
			return POD_ERR_RANGE;
		}
		pod_put_u8(w, m->kind);
		pod_put_u8(w, m->detail);
		pod_put_u32(w, m->transition_gnss_s);
		return POD_OK;
	}
	case POD_REC_HEALTH: {
		const struct pod_rec_health *h = &r->u.health;

		if (h->battery_pct > 100 && h->battery_pct != 0x7f) {
			return POD_ERR_RANGE;
		}
		pod_put_u8(w, h->battery_pct);
		pod_put_u16(w, h->battery_mv);
		pod_put_i16(w, h->battery_temp_centi_c);
		pod_put_i16(w, h->mcu_temp_centi_c);
		pod_put_u16(w, h->charge_cycles_n);
		pod_put_u16(w, h->bad_blocks_n);
		pod_put_u16(w, h->free_blocks_n);
		pod_put_u16(w, h->ecc_corrected_n);
		return POD_OK;
	}
	case POD_REC_RADIO_TX: {
		const struct pod_rec_radio_tx *t = &r->u.radio_tx;

		pod_put_u16(w, t->frame_number);
		pod_put_u32(w, t->duration_us);
		pod_put_i8(w, t->tx_power_dbm);
		pod_put_u8(w, t->message_type_byte);
		return POD_OK;
	}
	case POD_REC_EVENT:
		if (r->u.event.code < POD_EVT_IMU_FIFO_OVERRUN || r->u.event.code > POD_EVT_WATCHDOG) {
			return POD_ERR_RANGE;
		}
		pod_put_u16(w, r->u.event.code);
		pod_put_u32(w, r->u.event.value);
		return POD_OK;
	default:
		pod_put_raw(w, r->u.raw.body, r->u.raw.body_len);
		return POD_OK;
	}
}

int pod_record_encode(const struct pod_log_record *r, uint8_t *out, size_t cap)
{
	struct pod_writer w;
	int len = pod_record_length(r);
	int rc;

	if (len < 0) {
		return len;
	}
	if (r->tick > MAX_TICK) {
		return POD_ERR_RANGE;
	}
	if ((size_t)len > cap) {
		return POD_ERR_LENGTH;
	}
	pod_writer_init(&w, out, cap);
	pod_put_u8(&w, r->type);
	pod_put_u16(&w, (uint32_t)(len - POD_RECORD_HEADER_LEN));
	pod_put_u48(&w, r->tick);
	rc = encode_body(r, &w);
	if (rc != POD_OK) {
		return rc;
	}
	if (w.overflow || w.len != (size_t)len) {
		return POD_ERR_LENGTH;
	}
	return len;
}

/* ------------------------------------------------------------------------ */
/* Pages. */

uint32_t pod_crc32(const uint8_t *data, size_t len)
{
	uint32_t crc = 0xffffffffu;

	for (size_t i = 0; i < len; i++) {
		crc ^= data[i];
		for (unsigned int k = 0; k < 8; k++) {
			crc = (crc & 1u) ? (0xedb88320u ^ (crc >> 1)) : (crc >> 1);
		}
	}
	return crc ^ 0xffffffffu;
}

void pod_log_page_iv(uint8_t key_epoch, uint32_t page_seq, uint8_t iv[16])
{
	memset(iv, 0, 16);
	iv[0] = POD_LOG_IV_DOMAIN;
	iv[1] = key_epoch;
	iv[2] = (uint8_t)page_seq;
	iv[3] = (uint8_t)(page_seq >> 8);
	iv[4] = (uint8_t)(page_seq >> 16);
	iv[5] = (uint8_t)(page_seq >> 24);
}

#define LOG_KEY_INFO_CTR "sport-performance/pod-log/v1/ctr"
#define LOG_KEY_INFO_CMAC "sport-performance/pod-log/v1/cmac"

int pod_log_derive_page_keys(const uint8_t storage_key[16], struct pod_log_page_keys *keys)
{
	int rc = pod_hkdf_sha256(storage_key, 16, (const uint8_t *)LOG_KEY_INFO_CTR,
				 strlen(LOG_KEY_INFO_CTR), keys->enc_key, 16);

	if (rc != POD_OK) {
		return rc;
	}
	return pod_hkdf_sha256(storage_key, 16, (const uint8_t *)LOG_KEY_INFO_CMAC,
			       strlen(LOG_KEY_INFO_CMAC), keys->mac_key, 16);
}

int pod_log_page_header_encode(const struct pod_log_page_header *h,
			       uint8_t out[POD_LOG_PAGE_HEADER_LEN])
{
	struct pod_writer w;
	uint8_t flags = (uint8_t)((h->segment_start ? POD_PAGE_FLAG_SEGMENT_START : 0u) |
				  (h->segment_end ? POD_PAGE_FLAG_SEGMENT_END : 0u) |
				  (h->continues ? POD_PAGE_FLAG_CONTINUES : 0u) |
				  (h->recovered ? POD_PAGE_FLAG_RECOVERED : 0u));

	if (h->payload_len > POD_LOG_PAGE_PAYLOAD_CAP) {
		return POD_ERR_RANGE;
	}
	if (h->first_record_offset != POD_LOG_NO_RECORD_START &&
	    h->first_record_offset >= h->payload_len) {
		return POD_ERR_RANGE;
	}
	if (h->recovered && (!h->segment_end || h->payload_len != 0)) {
		return POD_ERR_RANGE;
	}
	pod_writer_init(&w, out, POD_LOG_PAGE_HEADER_LEN);
	pod_put_raw(&w, (const uint8_t *)"SPLG", 4);
	pod_put_u8(&w, POD_LOG_FORMAT_VERSION);
	pod_put_u8(&w, h->key_epoch);
	pod_put_u8(&w, flags);
	pod_put_u8(&w, 0);
	pod_put_raw(&w, h->device_id, POD_DEVICE_ID_LEN);
	pod_put_u32(&w, h->boot_counter);
	pod_put_u32(&w, h->segment_id);
	pod_put_u32(&w, h->page_seq);
	pod_put_u32(&w, h->stream_offset);
	pod_put_u16(&w, h->payload_len);
	pod_put_u16(&w, h->first_record_offset);
	pod_put_u16(&w, h->record_count);
	pod_put_u16(&w, 0);
	return w.overflow ? POD_ERR_LENGTH : POD_OK;
}

int pod_log_page_seal(const struct pod_log_page_header *h, const uint8_t *payload,
		      const struct pod_log_page_keys *keys, uint8_t page[POD_LOG_PAGE_SIZE])
{
	uint8_t plaintext[POD_LOG_PAGE_PAYLOAD_CAP];
	uint8_t iv[16];
	uint8_t mac[16];
	uint32_t crc;
	int rc;

	rc = pod_log_page_header_encode(h, page);
	if (rc != POD_OK) {
		return rc;
	}
	memset(plaintext, 0, sizeof(plaintext));
	if (h->payload_len > 0) {
		memcpy(plaintext, payload, h->payload_len);
	}
	pod_log_page_iv(h->key_epoch, h->page_seq, iv);
	rc = pod_aes128_ctr(keys->enc_key, iv, plaintext, &page[POD_LOG_PAGE_HEADER_LEN],
			    POD_LOG_PAGE_PAYLOAD_CAP);
	if (rc != POD_OK) {
		return rc;
	}
	/* Encrypt then MAC: the CMAC covers the clear header and the ciphertext. */
	rc = pod_aes128_cmac(keys->mac_key, page, POD_LOG_PAGE_MAC_OFFSET, mac);
	if (rc != POD_OK) {
		return rc;
	}
	memcpy(&page[POD_LOG_PAGE_MAC_OFFSET], mac, POD_LOG_PAGE_MAC_LEN);
	crc = pod_crc32(page, POD_LOG_PAGE_CRC_OFFSET);
	page[POD_LOG_PAGE_CRC_OFFSET] = (uint8_t)crc;
	page[POD_LOG_PAGE_CRC_OFFSET + 1] = (uint8_t)(crc >> 8);
	page[POD_LOG_PAGE_CRC_OFFSET + 2] = (uint8_t)(crc >> 16);
	page[POD_LOG_PAGE_CRC_OFFSET + 3] = (uint8_t)(crc >> 24);
	return POD_OK;
}

/* ------------------------------------------------------------------------ */
/* Writer. */

int pod_log_writer_init(struct pod_log_writer *w, const struct pod_log_writer_options *opt,
			const uint8_t storage_key[16], pod_log_page_sink_t sink, void *sink_ctx)
{
	memset(w, 0, sizeof(*w));
	w->opt = *opt;
	w->key_epoch = opt->key_epoch;
	w->next_page_seq = opt->first_page_seq;
	w->first_record_offset = POD_LOG_NO_RECORD_START;
	w->sink = sink;
	w->sink_ctx = sink_ctx;
	return pod_log_derive_page_keys(storage_key, &w->keys);
}

int pod_log_writer_rotate_key(struct pod_log_writer *w, uint8_t key_epoch,
			      const uint8_t storage_key[16])
{
	int rc = pod_log_derive_page_keys(storage_key, &w->keys);

	if (rc == POD_OK) {
		w->key_epoch = key_epoch;
	}
	return rc;
}

unsigned int pod_log_writer_pages_sealed_by(const struct pod_log_writer *w, size_t record_len)
{
	return (unsigned int)((w->length + record_len) / POD_LOG_PAGE_PAYLOAD_CAP);
}

static int writer_seal(struct pod_log_writer *w, bool continues, bool segment_end)
{
	struct pod_log_page_header h;
	int rc;

	if (w->next_page_seq > 0xffffffffull) {
		return POD_ERR_EXHAUSTED;
	}
	memset(&h, 0, sizeof(h));
	h.key_epoch = w->key_epoch;
	h.segment_start = w->stream_offset == 0;
	h.segment_end = segment_end;
	h.continues = continues;
	memcpy(h.device_id, w->opt.device_id, POD_DEVICE_ID_LEN);
	h.boot_counter = w->opt.boot_counter;
	h.segment_id = w->opt.segment_id;
	h.page_seq = (uint32_t)w->next_page_seq;
	h.stream_offset = w->stream_offset;
	h.payload_len = w->length;
	h.first_record_offset = w->first_record_offset;
	h.record_count = w->record_count;
	rc = pod_log_page_seal(&h, w->buffer, &w->keys, w->page);
	if (rc != POD_OK) {
		return rc;
	}
	w->next_page_seq++;
	w->stream_offset += w->length;
	w->length = 0;
	w->first_record_offset = POD_LOG_NO_RECORD_START;
	w->record_count = 0;
	return w->sink ? w->sink(w->sink_ctx, w->page) : POD_OK;
}

int pod_log_writer_append_bytes(struct pod_log_writer *w, const uint8_t *record, size_t len)
{
	size_t offset = 0;

	if (w->closed) {
		return POD_ERR_STATE;
	}
	if (len < POD_RECORD_HEADER_LEN) {
		return POD_ERR_LENGTH;
	}
	if (w->first_record_offset == POD_LOG_NO_RECORD_START) {
		w->first_record_offset = w->length;
	}
	w->record_count++;
	while (offset < len) {
		size_t room = POD_LOG_PAGE_PAYLOAD_CAP - w->length;
		size_t chunk = len - offset < room ? len - offset : room;

		memcpy(&w->buffer[w->length], &record[offset], chunk);
		w->length = (uint16_t)(w->length + chunk);
		offset += chunk;
		if (w->length == POD_LOG_PAGE_PAYLOAD_CAP) {
			int rc = writer_seal(w, offset < len, false);

			if (rc != POD_OK) {
				return rc;
			}
		}
	}
	return POD_OK;
}

int pod_log_writer_append(struct pod_log_writer *w, const struct pod_log_record *r)
{
	int len = pod_record_encode(r, w->scratch, sizeof(w->scratch));

	if (len < 0) {
		return len;
	}
	return pod_log_writer_append_bytes(w, w->scratch, (size_t)len);
}

int pod_log_writer_flush(struct pod_log_writer *w)
{
	if (w->closed) {
		return POD_ERR_STATE;
	}
	return w->length == 0 ? POD_OK : writer_seal(w, false, false);
}

int pod_log_writer_close(struct pod_log_writer *w)
{
	int rc;

	if (w->closed) {
		return POD_ERR_STATE;
	}
	rc = writer_seal(w, false, true);
	if (rc == POD_OK) {
		w->closed = true;
	}
	return rc;
}

int pod_log_seal_recovery_page(const uint8_t device_id[POD_DEVICE_ID_LEN], uint32_t boot_counter,
			       uint32_t segment_id, uint32_t stream_offset, uint32_t page_seq,
			       uint8_t key_epoch, const uint8_t storage_key[16],
			       uint8_t page[POD_LOG_PAGE_SIZE])
{
	struct pod_log_page_header h;
	struct pod_log_page_keys keys;
	int rc = pod_log_derive_page_keys(storage_key, &keys);

	if (rc != POD_OK) {
		return rc;
	}
	memset(&h, 0, sizeof(h));
	h.key_epoch = key_epoch;
	h.segment_start = stream_offset == 0;
	h.segment_end = true;
	h.recovered = true;
	memcpy(h.device_id, device_id, POD_DEVICE_ID_LEN);
	h.boot_counter = boot_counter;
	h.segment_id = segment_id;
	h.page_seq = page_seq;
	h.stream_offset = stream_offset;
	h.payload_len = 0;
	h.first_record_offset = POD_LOG_NO_RECORD_START;
	h.record_count = 0;
	return pod_log_page_seal(&h, NULL, &keys, page);
}
