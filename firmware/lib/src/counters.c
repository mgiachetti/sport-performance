/*
 * Persistent counters (see pod/counters.h).
 */
#include <string.h>

#include "pod/counters.h"
#include "pod/errors.h"

int pod_counters_boot(struct pod_counters *c, const struct pod_counter_store *store)
{
	uint32_t boot = 0, reserved = 0, segment = 0;

	memset(c, 0, sizeof(*c));
	c->store = *store;
	if (store->load(store->ctx, POD_COUNTER_BOOT, &boot) != 0 ||
	    store->load(store->ctx, POD_COUNTER_PAGE_SEQ_RESERVED, &reserved) != 0 ||
	    store->load(store->ctx, POD_COUNTER_SEGMENT_ID, &segment) != 0) {
		return POD_ERR_STATE;
	}
	if (boot == UINT32_MAX) {
		return POD_ERR_EXHAUSTED;
	}
	/* Local copy first: committed only once the store has it. */
	if (store->save(store->ctx, POD_COUNTER_BOOT, boot + 1u) != 0) {
		return POD_ERR_STATE;
	}
	c->boot = boot + 1u;
	c->segment_id = segment;
	/* Everything below the saved reservation may have been used before the reset. */
	c->page_seq_next = reserved;
	c->page_seq_reserved = reserved;
	c->ready = true;
	return POD_OK;
}

bool pod_counters_ready(const struct pod_counters *c)
{
	return c->ready;
}

int pod_counters_set_boot(struct pod_counters *c, uint32_t boot_counter)
{
	if (!c->ready) {
		return POD_ERR_STATE;
	}
	if (c->store.save(c->store.ctx, POD_COUNTER_BOOT, boot_counter) != 0) {
		/* The nonce could repeat after a reset: stop until it is saved. */
		c->ready = false;
		return POD_ERR_STATE;
	}
	c->boot = boot_counter;
	return POD_OK;
}

void pod_counters_observe_page_seq(struct pod_counters *c, uint32_t seen)
{
	if (seen != UINT32_MAX && seen + 1u > c->page_seq_next) {
		c->page_seq_next = seen + 1u;
	} else if (seen == UINT32_MAX) {
		c->page_seq_next = UINT32_MAX;
	}
}

int pod_counters_take_page_seq(struct pod_counters *c, uint32_t *seq)
{
	if (!c->ready) {
		return POD_ERR_STATE;
	}
	if (c->page_seq_next == UINT32_MAX) {
		return POD_ERR_EXHAUSTED;
	}
	if (c->page_seq_next >= c->page_seq_reserved) {
		uint32_t room = UINT32_MAX - c->page_seq_next;
		uint32_t reserve = c->page_seq_next +
				   (room < POD_PAGE_SEQ_RESERVATION ? room : POD_PAGE_SEQ_RESERVATION);

		if (c->store.save(c->store.ctx, POD_COUNTER_PAGE_SEQ_RESERVED, reserve) != 0) {
			return POD_ERR_STATE;
		}
		c->page_seq_reserved = reserve;
	}
	*seq = c->page_seq_next++;
	return POD_OK;
}

int pod_counters_next_segment(struct pod_counters *c, uint32_t *segment_id)
{
	if (!c->ready) {
		return POD_ERR_STATE;
	}
	if (c->segment_id == UINT32_MAX) {
		return POD_ERR_EXHAUSTED;
	}
	if (c->store.save(c->store.ctx, POD_COUNTER_SEGMENT_ID, c->segment_id + 1u) != 0) {
		return POD_ERR_STATE;
	}
	*segment_id = ++c->segment_id;
	return POD_OK;
}
