/*
 * Persistent counters of the pod (ADR 0106), as pure logic over an injectable
 * store (NVS on the target, a fake in the host tests):
 *
 * - **Boot counter**: half of the link nonce. Incremented on a local copy and
 *   committed only after the store saved it; until then the pod is not ready
 *   and never transmits nor records.
 * - **Page sequence** of the NAND log: half of the CTR IV, monotonic for the
 *   whole life of the pod (not per segment, not per boot). Handed out one page
 *   at a time; a block of sequences is reserved in the store *before* the first
 *   one of the block is used, so a reset anywhere starts above every sequence
 *   that could have been used. If the reservation cannot be saved, no sequence
 *   is handed out and the writer seals nothing.
 * - **Segment id**: monotonic per pod, committed after the save.
 */
#ifndef POD_COUNTERS_H_
#define POD_COUNTERS_H_

#include <stdbool.h>
#include <stdint.h>

/** Sequences reserved per store write (pod-protocol README: "de a 1024"). */
#define POD_PAGE_SEQ_RESERVATION 1024u

enum pod_counter_key {
	POD_COUNTER_BOOT = 0,
	POD_COUNTER_PAGE_SEQ_RESERVED,
	POD_COUNTER_SEGMENT_ID,
};

struct pod_counter_store {
	/** Returns 0 and fills `*value`; a missing key returns 0 with `*value = 0`. */
	int (*load)(void *ctx, enum pod_counter_key key, uint32_t *value);
	/** Returns 0 only when the value is durably written. */
	int (*save)(void *ctx, enum pod_counter_key key, uint32_t value);
	void *ctx;
};

struct pod_counters {
	struct pod_counter_store store;
	bool ready;
	uint32_t boot;
	uint32_t segment_id;
	/** Next sequence to hand out. */
	uint32_t page_seq_next;
	/** First sequence NOT covered by the saved reservation. */
	uint32_t page_seq_reserved;
};

/**
 * Loads the counters and commits a new boot counter. Returns POD_OK and sets
 * `ready`, or an error and leaves `ready` false (load or save failed, or the
 * boot counter is exhausted: rotate the keys at the dock).
 */
int pod_counters_boot(struct pod_counters *c, const struct pod_counter_store *store);

bool pod_counters_ready(const struct pod_counters *c);

/** Saves a new boot counter (frame-number wrap); commits only after the save. */
int pod_counters_set_boot(struct pod_counters *c, uint32_t boot_counter);

/** Moves the next page sequence above one seen on the NAND (boot scan). */
void pod_counters_observe_page_seq(struct pod_counters *c, uint32_t seen);

/**
 * Hands out the next page sequence, reserving a new block in the store first
 * when the next one is not covered. POD_ERR_STATE when not ready or the
 * reservation could not be saved; POD_ERR_EXHAUSTED at the end of the u32 range.
 */
int pod_counters_take_page_seq(struct pod_counters *c, uint32_t *seq);

/** Next segment id, committed after the save. */
int pod_counters_next_segment(struct pod_counters *c, uint32_t *segment_id);

#endif /* POD_COUNTERS_H_ */
