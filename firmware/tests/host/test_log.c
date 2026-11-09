/*
 * NAND log against packages/pod-protocol/fixtures/v1/log-vectors.json: every
 * record, the page keys and every sealed page of the two segments byte for byte.
 */
#include <stdio.h>
#include <string.h>

#include "fixtures_v1.h"
#include "pod/bytes.h"
#include "pod/errors.h"
#include "pod/log.h"
#include "pod/radio.h"
#include "test.h"

#define COUNT(a) (sizeof(a) / sizeof((a)[0]))
#define MAX_PAGES 16

struct page_sink {
	uint8_t pages[MAX_PAGES][POD_LOG_PAGE_SIZE];
	size_t n;
};

static int collect(void *ctx, const uint8_t page[POD_LOG_PAGE_SIZE])
{
	struct page_sink *s = ctx;

	if (s->n >= MAX_PAGES) {
		return POD_ERR_LENGTH;
	}
	memcpy(s->pages[s->n++], page, POD_LOG_PAGE_SIZE);
	return POD_OK;
}

static const struct fx_storage_key *storage_key(uint8_t epoch)
{
	for (size_t i = 0; i < COUNT(fx_storage_keys); i++) {
		if (fx_storage_keys[i].epoch == epoch) {
			return &fx_storage_keys[i];
		}
	}
	return NULL;
}

static void storage_and_page_keys(void)
{
	uint8_t master[32], device[8], key[16];
	struct pod_log_page_keys keys;

	hex_decode(FX_LOG_MASTER_KEY_HEX, master, sizeof(master));
	hex_decode(FX_LOG_DEVICE_ID_HEX, device, sizeof(device));
	for (size_t i = 0; i < COUNT(fx_storage_keys); i++) {
		const struct fx_storage_key *k = &fx_storage_keys[i];

		CHECK_EQ(pod_derive_key(master, "storage", device, 8, k->epoch, key), POD_OK);
		CHECK_HEX(key, 16, k->key_hex);
		CHECK_EQ(pod_log_derive_page_keys(key, &keys), POD_OK);
		CHECK_HEX(keys.enc_key, 16, k->enc_hex);
		CHECK_HEX(keys.mac_key, 16, k->mac_hex);
	}
}

static void record_vectors(void)
{
	static uint8_t out[POD_LOG_MAX_RECORD_LEN];
	char name[32];

	for (size_t i = 0; i < COUNT(fx_records); i++) {
		int n = pod_record_encode(&fx_records[i], out, sizeof(out));

		snprintf(name, sizeof(name), "record[%zu]", i);
		test_current = name;
		CHECK(n > 0);
		CHECK_EQ(n, pod_record_length(&fx_records[i]));
		CHECK_HEX(out, n > 0 ? (size_t)n : 0, fx_records_hex[i]);
	}
	test_current = "record_vectors";
}

static void write_segment(const char *name, const struct pod_log_record *records, size_t n,
			  uint32_t boot, uint32_t segment, uint32_t first_seq, uint8_t epoch,
			  int rotate_before, uint8_t new_epoch, const char *const *pages,
			  size_t pages_n)
{
	static struct pod_log_writer w;
	static struct page_sink sink;
	struct pod_log_writer_options opt = {
		.boot_counter = boot,
		.segment_id = segment,
		.first_page_seq = first_seq,
		.key_epoch = epoch,
	};
	uint8_t key[16];

	test_current = name;
	memset(&sink, 0, sizeof(sink));
	hex_decode(FX_LOG_DEVICE_ID_HEX, opt.device_id, sizeof(opt.device_id));
	hex_decode(storage_key(epoch)->key_hex, key, sizeof(key));
	CHECK_EQ(pod_log_writer_init(&w, &opt, key, collect, &sink), POD_OK);
	for (size_t i = 0; i < n; i++) {
		if ((int)i == rotate_before) {
			hex_decode(storage_key(new_epoch)->key_hex, key, sizeof(key));
			CHECK_EQ(pod_log_writer_rotate_key(&w, new_epoch, key), POD_OK);
		}
		CHECK_EQ(pod_log_writer_append(&w, &records[i]), POD_OK);
	}
	CHECK_EQ(pod_log_writer_close(&w), POD_OK);
	CHECK_EQ(pod_log_writer_append(&w, &records[0]), POD_ERR_STATE);
	CHECK_EQ(sink.n, pages_n);
	for (size_t p = 0; p < sink.n && p < pages_n; p++) {
		CHECK_HEX(sink.pages[p], POD_LOG_PAGE_SIZE, pages[p]);
	}
}

static void segment_vectors(void)
{
	write_segment("segment", fx_segment_records, COUNT(fx_segment_records),
		      FX_SEGMENT_BOOT_COUNTER, FX_SEGMENT_SEGMENT_ID, FX_SEGMENT_FIRST_PAGE_SEQ,
		      FX_SEGMENT_KEY_EPOCH, -1, 0, fx_segment_pages, COUNT(fx_segment_pages));
	write_segment("epoch_change", fx_epoch_records, COUNT(fx_epoch_records),
		      FX_EPOCH_BOOT_COUNTER, FX_EPOCH_SEGMENT_ID, FX_EPOCH_FIRST_PAGE_SEQ,
		      FX_EPOCH_KEY_EPOCH, FX_EPOCH_ROTATE_BEFORE, FX_EPOCH_NEW_KEY_EPOCH,
		      fx_epoch_pages, COUNT(fx_epoch_pages));
}

static void recovery_page(void)
{
	uint8_t device[8], key[16], page[POD_LOG_PAGE_SIZE];
	uint32_t crc;

	hex_decode(FX_LOG_DEVICE_ID_HEX, device, sizeof(device));
	hex_decode(fx_storage_keys[0].key_hex, key, sizeof(key));
	CHECK_EQ(pod_log_seal_recovery_page(device, 70000, 7, 1234, 9000, fx_storage_keys[0].epoch,
					    key, page),
		 POD_OK);
	CHECK(memcmp(page, "SPLG", 4) == 0);
	CHECK_EQ(page[6], POD_PAGE_FLAG_SEGMENT_END | POD_PAGE_FLAG_RECOVERED);
	CHECK_EQ(pod_get_u16(&page[32]), 0);
	CHECK_EQ(pod_get_u16(&page[34]), POD_LOG_NO_RECORD_START);
	crc = pod_crc32(page, POD_LOG_PAGE_CRC_OFFSET);
	CHECK_EQ(pod_get_u32(&page[POD_LOG_PAGE_CRC_OFFSET]), crc);
}

static void pages_sealed_by(void)
{
	static struct pod_log_writer w;
	struct pod_log_writer_options opt = {.key_epoch = 2};
	uint8_t key[16] = {0};
	uint8_t record[POD_RECORD_HEADER_LEN + 100] = {POD_REC_EVENT};

	CHECK_EQ(pod_log_writer_init(&w, &opt, key, NULL, NULL), POD_OK);
	CHECK_EQ(pod_log_writer_pages_sealed_by(&w, 1995), 0);
	CHECK_EQ(pod_log_writer_pages_sealed_by(&w, 1996), 1);
	CHECK_EQ(pod_log_writer_pages_sealed_by(&w, 4000), 2);
	CHECK_EQ(pod_log_writer_append_bytes(&w, record, sizeof(record)), POD_OK);
	CHECK_EQ(pod_log_writer_pages_sealed_by(&w, 1996 - sizeof(record) - 1), 0);
	CHECK_EQ(pod_log_writer_pages_sealed_by(&w, 1996 - sizeof(record)), 1);
	CHECK_EQ(pod_log_writer_flush(&w), POD_OK);
	CHECK_EQ(w.stream_offset, sizeof(record));
	CHECK_EQ(pod_log_writer_flush(&w), POD_OK); /* empty: nothing sealed */
	CHECK_EQ(w.next_page_seq, 1);
}

static void crc32_zlib(void)
{
	CHECK_EQ(pod_crc32((const uint8_t *)"123456789", 9), 0xCBF43926u);
}

void run_log_tests(void)
{
	RUN(crc32_zlib);
	RUN(storage_and_page_keys);
	RUN(record_vectors);
	RUN(segment_vectors);
	RUN(recovery_page);
	RUN(pages_sealed_by);
}
