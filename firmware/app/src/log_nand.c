/*
 * W25N04KV / W25N02KV on SPIM3 and the recording segment writer.
 *
 * The page format (header, CTR, CMAC, CRC, record stream) is
 * firmware/lib/src/log.c, checked byte for byte against the TypeScript golden
 * fixtures. This file is the SPI-NAND driver stub under it.
 *
 * Stub status (B-904): command set wired (reset, JEDEC ID, page read to cache,
 * read from cache, program load + execute, block erase, status polling); TODO:
 * bad-block table (factory marker and the W25N LUT), ECC status per read,
 * the segment index in the 8 reserved blocks, scanNand at boot, recovery close,
 * free-block allocation with the reserve block, and placing the SPIM3 buffers
 * in their own RAM block (errata 198).
 */
#include <string.h>

#include <zephyr/drivers/spi.h>
#include <zephyr/drivers/hwinfo.h>
#include <zephyr/kernel.h>
#include <zephyr/logging/log.h>

#include "pod_app.h"

LOG_MODULE_REGISTER(pod_nand, CONFIG_POD_LOG_LEVEL);

#define NAND_NODE DT_NODELABEL(nand)

#define W25N_RESET 0xFF
#define W25N_JEDEC_ID 0x9F
#define W25N_READ_STATUS 0x0F
#define W25N_WRITE_ENABLE 0x06
#define W25N_PAGE_DATA_READ 0x13
#define W25N_READ 0x03
#define W25N_PROGRAM_LOAD 0x02
#define W25N_PROGRAM_EXECUTE 0x10
#define W25N_BLOCK_ERASE 0xD8
#define W25N_SR3 0xC0
#define W25N_SR3_BUSY 0x01
#define W25N_SR3_E_FAIL 0x04
#define W25N_SR3_P_FAIL 0x08
#define W25N_SR3_ECC_MASK 0x30
/* Blocks at the start that hold the segment index (a cache: scanNand rebuilds it). */
#define RESERVED_INDEX_BLOCKS 8u

static const struct spi_dt_spec nand =
	SPI_DT_SPEC_GET(NAND_NODE, SPI_OP_MODE_MASTER | SPI_TRANSFER_MSB | SPI_WORD_SET(8));
static const uint32_t pages_per_block = DT_PROP(NAND_NODE, pages_per_block);

static struct pod_log_writer writer;
static bool segment_open;
static uint32_t next_page;
static uint8_t device_id[POD_DEVICE_ID_LEN];
/*
 * TODO(B-904): the storage key of the current epoch arrives wrapped from the
 * dock (ADR 0106) and lives in protected storage. All zero until then, and the
 * writer refuses an all-zero key: an unprovisioned pod records nothing.
 */
static uint8_t storage_key[16];
static uint8_t storage_epoch;

static int command(const uint8_t *tx, size_t tx_len, uint8_t *rx, size_t rx_len)
{
	struct spi_buf tx_buf = {.buf = (void *)tx, .len = tx_len};
	struct spi_buf rx_bufs[2] = {{.buf = NULL, .len = tx_len}, {.buf = rx, .len = rx_len}};
	struct spi_buf_set txs = {.buffers = &tx_buf, .count = 1};
	struct spi_buf_set rxs = {.buffers = rx_bufs, .count = 2};

	return spi_transceive_dt(&nand, &txs, rx_len ? &rxs : NULL);
}

static int wait_ready(uint8_t *status, k_timeout_t timeout)
{
	const uint8_t cmd[2] = {W25N_READ_STATUS, W25N_SR3};
	k_timepoint_t end = sys_timepoint_calc(timeout);

	do {
		int rc = command(cmd, sizeof(cmd), status, 1);

		if (rc != 0) {
			return rc;
		}
		if ((*status & W25N_SR3_BUSY) == 0) {
			return 0;
		}
		k_usleep(50);
	} while (!sys_timepoint_expired(end));
	return -ETIMEDOUT;
}

static int write_enable(void)
{
	const uint8_t cmd = W25N_WRITE_ENABLE;

	return command(&cmd, 1, NULL, 0);
}

/*
 * Page address of the W25N: 24 bits (8 dummy bits + 16 on the W25N01; the
 * W25N02KV/04KV need more than 16 bits). TODO(B-904): confirm the page address
 * format of the 2/4 Gbit parts against the Winbond sheet before the bench.
 */
static void page_address(uint8_t *out, uint32_t page)
{
	out[0] = (uint8_t)(page >> 16);
	out[1] = (uint8_t)(page >> 8);
	out[2] = (uint8_t)page;
}

static int program_page(uint32_t page, const uint8_t data[POD_LOG_PAGE_SIZE])
{
	uint8_t head[3] = {W25N_PROGRAM_LOAD, 0x00, 0x00}; /* column 0 */
	uint8_t exec[4] = {W25N_PROGRAM_EXECUTE};
	struct spi_buf bufs[2] = {{.buf = head, .len = sizeof(head)},
				  {.buf = (void *)data, .len = POD_LOG_PAGE_SIZE}};
	struct spi_buf_set set = {.buffers = bufs, .count = 2};
	uint8_t status;
	int rc = write_enable();

	if (rc == 0) {
		rc = spi_write_dt(&nand, &set);
	}
	if (rc == 0) {
		page_address(&exec[1], page);
		rc = command(exec, sizeof(exec), NULL, 0);
	}
	if (rc == 0) {
		rc = wait_ready(&status, K_MSEC(5));
	}
	if (rc == 0 && (status & W25N_SR3_P_FAIL)) {
		/* TODO(B-904): mark the block bad and rewrite the page in the next good block. */
		return -EIO;
	}
	return rc;
}

/** Reads a page; `ecc` gets bits ECC-1:0 of SR3 (0 ok, 1 corrected, 2 uncorrectable). */
int pod_nand_read_page(uint32_t page, uint8_t data[POD_LOG_PAGE_SIZE], uint8_t *ecc)
{
	uint8_t load[4] = {W25N_PAGE_DATA_READ};
	const uint8_t read[4] = {W25N_READ, 0x00, 0x00, 0x00}; /* column 0 + dummy */
	uint8_t status;
	int rc;

	page_address(&load[1], page);
	rc = command(load, sizeof(load), NULL, 0);
	if (rc == 0) {
		rc = wait_ready(&status, K_MSEC(1));
	}
	if (rc == 0) {
		*ecc = (uint8_t)((status & W25N_SR3_ECC_MASK) >> 4);
		rc = command(read, sizeof(read), data, POD_LOG_PAGE_SIZE);
	}
	return rc;
}

int pod_nand_erase_block(uint32_t block)
{
	uint8_t cmd[4] = {W25N_BLOCK_ERASE};
	uint8_t status;
	int rc = write_enable();

	if (rc == 0) {
		page_address(&cmd[1], block * pages_per_block);
		rc = command(cmd, sizeof(cmd), NULL, 0);
	}
	if (rc == 0) {
		rc = wait_ready(&status, K_MSEC(15));
	}
	if (rc == 0 && (status & W25N_SR3_E_FAIL)) {
		return -EIO;
	}
	return rc;
}

static int sink(void *ctx, const uint8_t page[POD_LOG_PAGE_SIZE])
{
	ARG_UNUSED(ctx);
	/* TODO(B-904): next free page of the segment's blocks (nextWritableBlock, reserve). */
	return program_page(next_page++, page) == 0 ? POD_OK : POD_ERR_STATE;
}

int pod_log_init(void)
{
	const uint8_t reset = W25N_RESET;
	const uint8_t id_cmd[2] = {W25N_JEDEC_ID, 0x00};
	uint8_t id[3];
	uint8_t status;
	int rc;

	if (!spi_is_ready_dt(&nand)) {
		return -ENODEV;
	}
	(void)hwinfo_get_device_id(device_id, sizeof(device_id));
	rc = command(&reset, 1, NULL, 0);
	if (rc == 0) {
		rc = wait_ready(&status, K_MSEC(5));
	}
	if (rc == 0) {
		rc = command(id_cmd, sizeof(id_cmd), id, sizeof(id));
	}
	if (rc != 0) {
		return rc;
	}
	LOG_INF("NAND JEDEC %02x %02x %02x", id[0], id[1], id[2]);
	if (id[0] != 0xEF) { /* Winbond */
		return -ENODEV;
	}
	/* TODO(B-904): clear the block protection bits (SR1) and run scanNand. */
	next_page = RESERVED_INDEX_BLOCKS * pages_per_block;
	return 0;
}

int pod_log_start_segment(void)
{
	struct pod_log_writer_options opt = {
		.boot_counter = pod_persist_boot(),
		.key_epoch = storage_epoch,
		.seq_source = pod_persist_take_page_seq,
	};
	int rc;

	segment_open = false;
	if (!pod_persist_ready()) {
		return -EACCES; /* boot counter not saved: no time epoch, no IV guarantee */
	}
	rc = pod_persist_next_segment(&opt.segment_id);
	if (rc != POD_OK) {
		return -EIO;
	}
	memcpy(opt.device_id, device_id, sizeof(opt.device_id));
	/* POD_ERR_STATE with the all-zero key of an unprovisioned pod: nothing is recorded. */
	rc = pod_log_writer_init(&writer, &opt, storage_key, sink, NULL);
	segment_open = rc == POD_OK;
	return rc == POD_OK ? 0 : -EACCES;
}

int pod_log_append(const struct pod_log_record *record)
{
	if (!segment_open) {
		return -EINVAL;
	}
	/* TODO(B-904): mayAppend — keep one page free for the close (memory full). */
	return pod_log_writer_append(&writer, record);
}

int pod_log_close_segment(void)
{
	int rc;

	if (!segment_open) {
		return 0;
	}
	rc = pod_log_writer_close(&writer);
	segment_open = false;
	return rc;
}

bool pod_log_idle(void)
{
	/* Writes are synchronous in this stub: idle whenever no call is in progress. */
	return true;
}
