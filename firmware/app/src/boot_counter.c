/*
 * Persistent counters in NVS (ADR 0106): the boot counter is incremented and
 * saved before the first transmission of every boot (System OFF wake-ups and
 * resets included), so (boot, frame) never repeats as a CCM nonce. The page
 * sequence of the NAND log is reserved in blocks so a reset never reuses a CTR IV.
 */
#include <errno.h>

#include <zephyr/kernel.h>
#include <zephyr/logging/log.h>
#include <zephyr/settings/settings.h>

#include "pod_app.h"

LOG_MODULE_REGISTER(pod_counters, CONFIG_POD_LOG_LEVEL);

/** Page sequences reserved per NVS write (README of pod-protocol: "de a 1024"). */
#define PAGE_SEQ_RESERVATION 1024u

static uint32_t boot_counter;
static uint32_t page_seq_reserved; /* first sequence NOT yet reserved */
static uint32_t page_seq_next;
static uint32_t segment_id;

static int set(const char *name, size_t len, settings_read_cb read_cb, void *cb_arg)
{
	uint32_t *target = NULL;

	if (settings_name_steq(name, "boot", NULL)) {
		target = &boot_counter;
	} else if (settings_name_steq(name, "pageseq", NULL)) {
		target = &page_seq_reserved;
	} else if (settings_name_steq(name, "segment", NULL)) {
		target = &segment_id;
	}
	if (target == NULL || len != sizeof(*target)) {
		return -ENOENT;
	}
	return read_cb(cb_arg, target, sizeof(*target)) == sizeof(*target) ? 0 : -EIO;
}

SETTINGS_STATIC_HANDLER_DEFINE(pod, "pod", NULL, set, NULL, NULL);

int pod_counters_init(void)
{
	int rc = settings_subsys_init();

	if (rc == 0) {
		rc = settings_load_subtree("pod");
	}
	if (rc != 0) {
		LOG_ERR("settings: %d", rc);
		return rc;
	}
	if (boot_counter == UINT32_MAX) {
		/* boot_counter_exhausted: never transmit until the keys rotate at the dock. */
		LOG_ERR("boot counter exhausted");
		return -ENOSPC;
	}
	boot_counter++;
	rc = settings_save_one("pod/boot", &boot_counter, sizeof(boot_counter));
	if (rc != 0) {
		return rc;
	}
	/*
	 * Start above everything reserved before. TODO(B-904): also above the highest
	 * sequence found by the NAND scan (scanNand) at boot.
	 */
	page_seq_next = page_seq_reserved;
	LOG_INF("boot %u", boot_counter);
	return 0;
}

uint32_t pod_counters_boot(void)
{
	return boot_counter;
}

int pod_counters_persist_boot(uint32_t value)
{
	boot_counter = value;
	return settings_save_one("pod/boot", &boot_counter, sizeof(boot_counter));
}

uint32_t pod_counters_next_page_seq(void)
{
	if (page_seq_next >= page_seq_reserved) {
		uint32_t reserve = page_seq_next + PAGE_SEQ_RESERVATION;

		if (settings_save_one("pod/pageseq", &reserve, sizeof(reserve)) == 0) {
			page_seq_reserved = reserve;
		}
	}
	return page_seq_next;
}

uint32_t pod_counters_next_segment_id(void)
{
	segment_id++;
	(void)settings_save_one("pod/segment", &segment_id, sizeof(segment_id));
	return segment_id;
}
