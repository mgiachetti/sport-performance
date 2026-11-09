/*
 * Persistent counters over a fake store: the boot counter is committed only
 * after its save, page sequences are never reused (same boot, several
 * segments, more than one reservation, reset mid-reservation, failed save),
 * and nothing is sealed with an unprovisioned (all-zero) key.
 */
#include <string.h>

#include "pod/bytes.h"
#include "pod/counters.h"
#include "pod/errors.h"
#include "pod/log.h"
#include "pod/radio.h"
#include "test.h"

struct fake_store {
	uint32_t values[3];
	bool fail_save[3];
	int saves[3];
};

static int fake_load(void *ctx, enum pod_counter_key key, uint32_t *value)
{
	struct fake_store *s = ctx;

	*value = s->values[key];
	return 0;
}

static int fake_save(void *ctx, enum pod_counter_key key, uint32_t value)
{
	struct fake_store *s = ctx;

	if (s->fail_save[key]) {
		return -5;
	}
	s->values[key] = value;
	s->saves[key]++;
	return 0;
}

static struct pod_counter_store store_of(struct fake_store *s)
{
	struct pod_counter_store st = {.load = fake_load, .save = fake_save, .ctx = s};

	return st;
}

static void boot_counter_committed_after_save(void)
{
	struct fake_store s = {.values = {41, 0, 0}};
	struct pod_counter_store st = store_of(&s);
	struct pod_counters c;

	CHECK_EQ(pod_counters_boot(&c, &st), POD_OK);
	CHECK(pod_counters_ready(&c));
	CHECK_EQ(c.boot, 42);
	CHECK_EQ(s.values[POD_COUNTER_BOOT], 42);

	/* The save fails: not ready, nothing committed, the next boot retries from 42. */
	s.fail_save[POD_COUNTER_BOOT] = true;
	CHECK_EQ(pod_counters_boot(&c, &st), POD_ERR_STATE);
	CHECK(!pod_counters_ready(&c));
	CHECK_EQ(c.boot, 0);
	CHECK_EQ(s.values[POD_COUNTER_BOOT], 42);
	{
		uint32_t seq, seg;

		CHECK_EQ(pod_counters_take_page_seq(&c, &seq), POD_ERR_STATE);
		CHECK_EQ(pod_counters_next_segment(&c, &seg), POD_ERR_STATE);
	}
	s.fail_save[POD_COUNTER_BOOT] = false;
	CHECK_EQ(pod_counters_boot(&c, &st), POD_OK);
	CHECK_EQ(c.boot, 43);

	/* Frame-number wrap: a failed save stops the pod. */
	s.fail_save[POD_COUNTER_BOOT] = true;
	CHECK_EQ(pod_counters_set_boot(&c, 44), POD_ERR_STATE);
	CHECK(!pod_counters_ready(&c));
	CHECK_EQ(c.boot, 43);

	s.values[POD_COUNTER_BOOT] = UINT32_MAX;
	s.fail_save[POD_COUNTER_BOOT] = false;
	CHECK_EQ(pod_counters_boot(&c, &st), POD_ERR_EXHAUSTED);
	CHECK(!pod_counters_ready(&c));
}

static void page_sequence_never_reused(void)
{
	struct fake_store s = {0};
	struct pod_counter_store st = store_of(&s);
	struct pod_counters c;
	uint32_t seq = 0, last = 0;

	CHECK_EQ(pod_counters_boot(&c, &st), POD_OK);
	/* First sequence reserves the first block before it is handed out. */
	CHECK_EQ(pod_counters_take_page_seq(&c, &seq), POD_OK);
	CHECK_EQ(seq, 0);
	CHECK_EQ(s.values[POD_COUNTER_PAGE_SEQ_RESERVED], POD_PAGE_SEQ_RESERVATION);
	/* More than one reservation in the same boot: monotonic, one save per block. */
	for (uint32_t i = 1; i < 3000; i++) {
		CHECK_EQ(pod_counters_take_page_seq(&c, &seq), POD_OK);
		if (seq != i) {
			CHECK_EQ(seq, i);
			break;
		}
		/* Never hand out a sequence the store does not cover. */
		if (seq >= s.values[POD_COUNTER_PAGE_SEQ_RESERVED]) {
			CHECK(seq < s.values[POD_COUNTER_PAGE_SEQ_RESERVED]);
			break;
		}
		last = seq;
	}
	CHECK_EQ(s.saves[POD_COUNTER_PAGE_SEQ_RESERVED], 3);
	CHECK_EQ(s.values[POD_COUNTER_PAGE_SEQ_RESERVED], 3 * POD_PAGE_SEQ_RESERVATION);

	/* Reset in the middle of a reservation: the next boot starts above all of it. */
	CHECK_EQ(pod_counters_boot(&c, &st), POD_OK);
	CHECK_EQ(pod_counters_take_page_seq(&c, &seq), POD_OK);
	CHECK(seq > last);
	CHECK_EQ(seq, 3 * POD_PAGE_SEQ_RESERVATION);

	/* The reservation cannot be saved: no sequence at the block boundary. */
	while (c.page_seq_next < c.page_seq_reserved) {
		CHECK_EQ(pod_counters_take_page_seq(&c, &seq), POD_OK);
	}
	s.fail_save[POD_COUNTER_PAGE_SEQ_RESERVED] = true;
	CHECK_EQ(pod_counters_take_page_seq(&c, &seq), POD_ERR_STATE);
	CHECK_EQ(pod_counters_take_page_seq(&c, &seq), POD_ERR_STATE);
	s.fail_save[POD_COUNTER_PAGE_SEQ_RESERVED] = false;
	last = seq;
	CHECK_EQ(pod_counters_take_page_seq(&c, &seq), POD_OK);
	CHECK_EQ(seq, 4 * POD_PAGE_SEQ_RESERVATION);

	/* A page seen on the NAND scan above the reservation moves the start. */
	pod_counters_observe_page_seq(&c, 100000);
	CHECK_EQ(pod_counters_take_page_seq(&c, &seq), POD_OK);
	CHECK_EQ(seq, 100001);
	CHECK(s.values[POD_COUNTER_PAGE_SEQ_RESERVED] > 100001);

	c.page_seq_next = UINT32_MAX;
	CHECK_EQ(pod_counters_take_page_seq(&c, &seq), POD_ERR_EXHAUSTED);
}

struct sink_log {
	uint32_t seqs[64];
	size_t n;
};

static int sink_seq(void *ctx, const uint8_t page[POD_LOG_PAGE_SIZE])
{
	struct sink_log *l = ctx;

	if (l->n < 64) {
		l->seqs[l->n++] = pod_get_le(&page[24], 4);
	}
	return POD_OK;
}

static int take_seq(void *ctx, uint32_t *seq)
{
	return pod_counters_take_page_seq(ctx, seq);
}

static void fill_page(struct pod_log_writer *w)
{
	static uint8_t record[POD_LOG_PAGE_PAYLOAD_CAP] = {POD_REC_EVENT};

	(void)pod_log_writer_append_bytes(w, record, sizeof(record));
}

static void segments_share_the_sequence(void)
{
	static struct pod_log_writer w;
	struct fake_store s = {0};
	struct pod_counter_store st = store_of(&s);
	struct pod_counters c;
	struct sink_log l = {0};
	uint8_t key[16] = {7};
	struct pod_log_writer_options opt = {.key_epoch = 2, .seq_source = take_seq, .seq_ctx = &c};

	CHECK_EQ(pod_counters_boot(&c, &st), POD_OK);
	/* ACTIVE → STANDBY → ACTIVE: two segments in the same boot. */
	for (int segment = 0; segment < 2; segment++) {
		CHECK_EQ(pod_counters_next_segment(&c, &opt.segment_id), POD_OK);
		CHECK_EQ(pod_log_writer_init(&w, &opt, key, sink_seq, &l), POD_OK);
		fill_page(&w);
		fill_page(&w);
		CHECK_EQ(pod_log_writer_close(&w), POD_OK);
	}
	CHECK_EQ(l.n, 6);
	for (size_t i = 0; i < l.n; i++) {
		CHECK_EQ(l.seqs[i], i); /* 0..5 across both segments: no IV repeats */
	}
	CHECK_EQ(s.values[POD_COUNTER_SEGMENT_ID], 2);

	/* No sequence (reservation not saved): nothing sealed, the writer stops. */
	c.page_seq_next = c.page_seq_reserved;
	s.fail_save[POD_COUNTER_PAGE_SEQ_RESERVED] = true;
	CHECK_EQ(pod_log_writer_init(&w, &opt, key, sink_seq, &l), POD_OK);
	fill_page(&w);
	CHECK_EQ(l.n, 6);
	CHECK_EQ(pod_log_writer_append_bytes(&w, (const uint8_t *)"\x71\x00\x00\x00\x00\x00\x00\x00\x00", 9),
		 POD_ERR_STATE);
}

static void unprovisioned_keys_seal_nothing(void)
{
	static struct pod_log_writer w;
	uint8_t zero[16] = {0}, page[POD_LOG_PAGE_SIZE], packet[64];
	uint8_t device[8] = {1};
	struct pod_log_writer_options opt = {.key_epoch = 1};
	struct pod_uplink_counters c = {.network_id = 1, .pod_short_id = 2, .boot_counter = 3};
	struct pod_log_page_keys keys;

	CHECK_EQ(pod_uplink_seal(zero, &c, NULL, false, packet, sizeof(packet)), POD_ERR_STATE);
	CHECK_EQ(pod_log_writer_init(&w, &opt, zero, NULL, NULL), POD_ERR_STATE);
	CHECK_EQ(pod_log_writer_append_bytes(&w, (const uint8_t *)"\x71\x00\x00\x00\x00\x00\x00\x00\x00", 9),
		 POD_ERR_STATE);
	CHECK_EQ(pod_log_writer_close(&w), POD_ERR_STATE);
	CHECK_EQ(pod_log_derive_page_keys(zero, &keys), POD_ERR_STATE);
	CHECK_EQ(pod_log_seal_recovery_page(device, 1, 1, 0, 1, 1, zero, page), POD_ERR_STATE);
}

void run_counters_tests(void)
{
	RUN(boot_counter_committed_after_save);
	RUN(page_sequence_never_reused);
	RUN(segments_share_the_sequence);
	RUN(unprovisioned_keys_seal_nothing);
}
