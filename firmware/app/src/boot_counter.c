/*
 * Settings (NVS) backend of the persistent counters. The rules (commit after
 * save, page-sequence reservation, never reuse) are pure in
 * firmware/lib/src/counters.c and host-tested with a fake store.
 *
 * The NVS lives in `storage_partition`, pinned in the devicetree of the board
 * so a firmware update never moves it. A chip erase or a recover wipes it:
 * the counters restart, so the pod must be re-keyed (new key epoch) at the
 * dock before it transmits or records again (firmware/README.md).
 */
#include <errno.h>

#include <zephyr/kernel.h>
#include <zephyr/logging/log.h>
#include <zephyr/settings/settings.h>

#include "pod/counters.h"
#include "pod_app.h"

LOG_MODULE_REGISTER(pod_counters, CONFIG_POD_LOG_LEVEL);

static const char *const names[] = {
	[POD_COUNTER_BOOT] = "pod/boot",
	[POD_COUNTER_PAGE_SEQ_RESERVED] = "pod/pageseq",
	[POD_COUNTER_SEGMENT_ID] = "pod/segment",
};

static uint32_t loaded[3];
static struct pod_counters counters;
static K_MUTEX_DEFINE(lock);

static int set(const char *name, size_t len, settings_read_cb read_cb, void *cb_arg)
{
	static const char *const keys[] = {"boot", "pageseq", "segment"};

	for (size_t i = 0; i < ARRAY_SIZE(keys); i++) {
		if (settings_name_steq(name, keys[i], NULL)) {
			if (len != sizeof(uint32_t)) {
				return -EINVAL;
			}
			return read_cb(cb_arg, &loaded[i], sizeof(uint32_t)) == sizeof(uint32_t)
				       ? 0
				       : -EIO;
		}
	}
	return -ENOENT;
}

SETTINGS_STATIC_HANDLER_DEFINE(pod, "pod", NULL, set, NULL, NULL);

static int store_load(void *ctx, enum pod_counter_key key, uint32_t *value)
{
	ARG_UNUSED(ctx);
	*value = loaded[key];
	return 0;
}

static int store_save(void *ctx, enum pod_counter_key key, uint32_t value)
{
	ARG_UNUSED(ctx);
	return settings_save_one(names[key], &value, sizeof(value));
}

int pod_persist_init(void)
{
	const struct pod_counter_store store = {.load = store_load, .save = store_save};
	int rc = settings_subsys_init();

	if (rc == 0) {
		rc = settings_load_subtree("pod");
	}
	if (rc != 0) {
		LOG_ERR("settings: %d", rc);
		return rc;
	}
	k_mutex_lock(&lock, K_FOREVER);
	rc = pod_counters_boot(&counters, &store);
	k_mutex_unlock(&lock);
	if (rc != POD_OK) {
		/* Not ready: the pod neither transmits nor records (nonce / IV safety). */
		LOG_ERR("counters not committed (%d)", rc);
		return -EIO;
	}
	LOG_INF("boot %u, page sequence from %u", counters.boot, counters.page_seq_next);
	return 0;
}

bool pod_persist_ready(void)
{
	return pod_counters_ready(&counters);
}

uint32_t pod_persist_boot(void)
{
	return counters.boot;
}

int pod_persist_set_boot(uint32_t boot_counter)
{
	int rc;

	k_mutex_lock(&lock, K_FOREVER);
	rc = pod_counters_set_boot(&counters, boot_counter);
	k_mutex_unlock(&lock);
	return rc;
}

int pod_persist_take_page_seq(void *ctx, uint32_t *page_seq)
{
	int rc;

	ARG_UNUSED(ctx);
	k_mutex_lock(&lock, K_FOREVER);
	rc = pod_counters_take_page_seq(&counters, page_seq);
	k_mutex_unlock(&lock);
	return rc;
}

int pod_persist_next_segment(uint32_t *segment_id)
{
	int rc;

	k_mutex_lock(&lock, K_FOREVER);
	rc = pod_counters_next_segment(&counters, segment_id);
	k_mutex_unlock(&lock);
	return rc;
}
