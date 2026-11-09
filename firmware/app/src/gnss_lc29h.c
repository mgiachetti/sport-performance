/*
 * LC29H on UARTE0 (UARTE1 on the DK): power and pins, the boot command
 * sequence with its acknowledgements, and the RX path that splits NMEA lines
 * from RTCM3 frames (firmware/lib/src/gnss.c, host-tested).
 *
 * Stub status (B-904): the sequence and parsers are real; the baud fallback,
 * the 1 Hz raw selection into `gnss_raw` records and the epoch/PPS pairing are
 * TODO until the bench (banco-gnss.md, B-901) confirms the module behaviour.
 */
#include <stdlib.h>
#include <string.h>

#include <zephyr/drivers/gpio.h>
#include <zephyr/drivers/uart.h>
#include <zephyr/kernel.h>
#include <zephyr/logging/log.h>
#include <zephyr/sys/ring_buffer.h>

#include "pod_app.h"

LOG_MODULE_REGISTER(pod_gnss, CONFIG_POD_LOG_LEVEL);

#define USER_NODE DT_PATH(zephyr_user)

static const struct device *const uart = DEVICE_DT_GET(DT_PHANDLE(USER_NODE, gnss_uart));
static const struct gpio_dt_spec en = GPIO_DT_SPEC_GET_OR(USER_NODE, gnss_en_gpios, {0});
static const struct gpio_dt_spec reset = GPIO_DT_SPEC_GET_OR(USER_NODE, gnss_reset_gpios, {0});
static const struct gpio_dt_spec wakeup = GPIO_DT_SPEC_GET_OR(USER_NODE, gnss_wakeup_gpios, {0});

RING_BUF_DECLARE(rx_ring, 4096);
static K_SEM_DEFINE(rx_sem, 0, 1);
static K_SEM_DEFINE(ack_sem, 0, 1);
static K_MUTEX_DEFINE(pvt_lock);

static struct pod_gnss_stream stream;
static struct pod_gnss_pvt latest;
static struct pod_gnss_pvt building;
static char version[65];

/* What the command runner is waiting for. */
static const struct pod_gnss_command *waiting;
static int waiting_result;

static void uart_isr(const struct device *dev, void *user_data)
{
	ARG_UNUSED(user_data);
	while (uart_irq_update(dev) && uart_irq_rx_ready(dev)) {
		uint8_t buf[64];
		int n = uart_fifo_read(dev, buf, sizeof(buf));

		if (n <= 0) {
			break;
		}
		if (ring_buf_put(&rx_ring, buf, (uint32_t)n) != (uint32_t)n) {
			/* Overrun: the parser resyncs on the next '$' or 0xD3. */
		}
		k_sem_give(&rx_sem);
	}
}

static bool starts_with(const char *body, size_t len, const char *name)
{
	size_t n = strlen(name);

	return len >= n && memcmp(body, name, n) == 0 && (len == n || body[n] == ',');
}

static void handle_ack(const char *body, size_t len)
{
	const struct pod_gnss_command *cmd = waiting;
	char name[32];
	const char *comma;
	size_t name_len;

	if (cmd == NULL) {
		return;
	}
	comma = strchr(cmd->body, ',');
	name_len = comma ? (size_t)(comma - cmd->body) : strlen(cmd->body);
	if (name_len >= sizeof(name)) {
		return;
	}
	memcpy(name, cmd->body, name_len);
	name[name_len] = '\0';

	switch (cmd->expect) {
	case POD_GNSS_EXPECT_PAIR_ACK: {
		uint16_t id;
		int result;

		if (pod_pair_ack_parse(body, len, &id, &result) == POD_OK &&
		    strtoul(&name[4], NULL, 10) == id && result != POD_PAIR_PROCESSING) {
			waiting_result = result;
			k_sem_give(&ack_sem);
		}
		break;
	}
	case POD_GNSS_EXPECT_PQTM_OK: {
		int rc = pod_pqtm_response_parse(body, len, name);

		if (rc >= 0) {
			waiting_result = rc;
			k_sem_give(&ack_sem);
		}
		break;
	}
	case POD_GNSS_EXPECT_RESPONSE:
		if (starts_with(body, len, name)) {
			if (strcmp(name, "PQTMVERNO") == 0) {
				size_t n = MIN(len - name_len - 1, sizeof(version) - 1);

				memcpy(version, &body[name_len + 1], n);
				version[n] = '\0';
			}
			waiting_result = 0;
			k_sem_give(&ack_sem);
		}
		break;
	default:
		break;
	}
}

static void on_nmea(void *ctx, const char *line, size_t len)
{
	const char *body;
	size_t body_len;

	ARG_UNUSED(ctx);
	if (pod_nmea_verify(line, len, &body, &body_len) != POD_OK) {
		return;
	}
	if (starts_with(body, body_len, "PQTMPVT")) {
		if (pod_pqtmpvt_parse(body, body_len, &building) == POD_OK) {
			k_mutex_lock(&pvt_lock, K_FOREVER);
			latest = building;
			k_mutex_unlock(&pvt_lock);
			/* TODO(B-904): gnss_pvt record into the log and live summary update. */
		}
	} else if (starts_with(body, body_len, "PQTMVEL")) {
		(void)pod_pqtmvel_parse(body, body_len, &building);
	} else if (starts_with(body, body_len, "PQTMEPE")) {
		(void)pod_pqtmepe_parse(body, body_len, &building);
	} else {
		handle_ack(body, body_len);
	}
}

static void on_rtcm(void *ctx, const uint8_t *frame, size_t len)
{
	ARG_UNUSED(ctx);
	ARG_UNUSED(frame);
	/*
	 * TODO(B-904): collect the MSM7 + ephemerides frames of the whole-second
	 * epoch into one `gnss_raw` record (format rtcm3_msm7) at 1 Hz; drop the
	 * other nine epochs if the module outputs raw at 10 Hz.
	 */
	LOG_DBG("RTCM frame %u B", (unsigned int)len);
}

static int send_command(const struct pod_gnss_command *cmd)
{
	char line[POD_NMEA_MAX_LEN];
	int n = pod_nmea_build(cmd->body, line, sizeof(line));

	if (n < 0) {
		return n;
	}
	for (int attempt = 0; attempt < 3; attempt++) {
		k_sem_reset(&ack_sem);
		waiting = cmd;
		for (int i = 0; i < n; i++) {
			uart_poll_out(uart, line[i]);
		}
		if (cmd->expect == POD_GNSS_EXPECT_NONE) {
			waiting = NULL;
			break;
		}
		if (k_sem_take(&ack_sem, K_MSEC(cmd->timeout_ms)) != 0) {
			waiting = NULL;
			LOG_WRN("%s: no answer", cmd->body);
			return -ETIMEDOUT;
		}
		waiting = NULL;
		if (cmd->expect == POD_GNSS_EXPECT_PAIR_ACK && waiting_result == POD_PAIR_BUSY) {
			continue; /* retry on "busy" */
		}
		if (waiting_result != 0) {
			/* Every unsupported command is logged: it reveals a variant or firmware change. */
			LOG_WRN("%s: result %d", cmd->body, waiting_result);
			return -EIO;
		}
		break;
	}
	if (cmd->delay_after_ms != 0) {
		k_sleep(K_MSEC(cmd->delay_after_ms));
	}
	return 0;
}

static int run_sequence(const struct pod_gnss_command *seq, size_t n)
{
	int failures = 0;

	for (size_t i = 0; i < n; i++) {
		if (send_command(&seq[i]) != 0) {
			failures++;
		}
	}
	return failures == 0 ? 0 : -EIO;
}

static void rx_thread(void *a, void *b, void *c)
{
	ARG_UNUSED(a);
	ARG_UNUSED(b);
	ARG_UNUSED(c);
	for (;;) {
		uint8_t buf[128];
		uint32_t n;

		k_sem_take(&rx_sem, K_FOREVER);
		while ((n = ring_buf_get(&rx_ring, buf, sizeof(buf))) > 0) {
			pod_gnss_stream_feed(&stream, buf, n);
		}
	}
}

K_THREAD_DEFINE(gnss_rx, 2048, rx_thread, NULL, NULL, NULL, 5, 0, 0);

static void pin_actions(const struct pod_gnss_pin_action *actions, size_t n)
{
	for (size_t i = 0; i < n; i++) {
		switch (actions[i].step) {
		case POD_GNSS_STEP_SEND_COMMANDS:
			(void)run_sequence(pod_lc29h_enter_backup, pod_lc29h_enter_backup_len);
			break;
		case POD_GNSS_STEP_EN_LOW:
			(void)gpio_pin_set_dt(&en, 0);
			break;
		case POD_GNSS_STEP_EN_HIGH:
			(void)gpio_pin_set_dt(&en, 1);
			break;
		case POD_GNSS_STEP_WAKEUP_HIGH:
			(void)gpio_pin_configure_dt(&wakeup, GPIO_OUTPUT_ACTIVE);
			break;
		case POD_GNSS_STEP_WAKEUP_RELEASE:
			/* Input with the buffer disconnected: no leak against the Hall pad. */
			(void)gpio_pin_configure_dt(&wakeup, GPIO_DISCONNECTED);
			break;
		case POD_GNSS_STEP_WAIT_MS:
		case POD_GNSS_STEP_WAIT_FIRST_LINE:
			/* TODO(B-904): wait for the first NMEA / $PQTMVER instead of a fixed time. */
			k_sleep(K_MSEC(actions[i].ms));
			break;
		}
	}
}

int pod_gnss_power(bool on)
{
	if (en.port == NULL) {
		return -ENODEV;
	}
	if (on) {
		pin_actions(pod_lc29h_backup_exit_actions, pod_lc29h_backup_exit_actions_len);
	} else {
		pin_actions(pod_lc29h_backup_enter_actions, pod_lc29h_backup_enter_actions_len);
	}
	return 0;
}

/*
 * The boot sequence takes seconds (2 s between $PAIR003 and $PAIR002, up to
 * 500 ms per command): it runs in its own thread so the main loop keeps
 * feeding the watchdog.
 */
static void boot_thread(void *a, void *b, void *c)
{
	int rc;

	ARG_UNUSED(a);
	ARG_UNUSED(b);
	ARG_UNUSED(c);
	(void)pod_gnss_power(true);
	/*
	 * TODO(B-904): if $PQTMVERNO does not answer at CONFIG_POD_GNSS_BAUD, reopen
	 * at CONFIG_POD_GNSS_FALLBACK_BAUD, send $PAIR864,0,0,921600, save and reboot
	 * the module (lc29h-protocolo.md, step 0).
	 */
	rc = run_sequence(pod_lc29h_aa_queries, pod_lc29h_aa_queries_len);
	if (rc != 0) {
		LOG_WRN("GNSS queries incomplete");
	}
	/* TODO(B-904): compare the answers and skip the NVM writes when nothing changed. */
	rc = run_sequence(pod_lc29h_aa_boot, pod_lc29h_aa_boot_len);
	LOG_INF("GNSS %s, boot sequence %s", version[0] ? version : "?",
		rc == 0 ? "ok" : "with errors");
}

K_THREAD_DEFINE(gnss_boot, 2048, boot_thread, NULL, NULL, NULL, 6, 0, SYS_FOREVER_MS);

int pod_gnss_init(void)
{
	if (!device_is_ready(uart)) {
		return -ENODEV;
	}
	pod_gnss_stream_init(&stream, on_nmea, on_rtcm, NULL);
	if (en.port != NULL) {
		(void)gpio_pin_configure_dt(&en, GPIO_OUTPUT_INACTIVE);
	}
	if (reset.port != NULL) {
		(void)gpio_pin_configure_dt(&reset, GPIO_OUTPUT_INACTIVE);
	}
	if (wakeup.port != NULL) {
		(void)gpio_pin_configure_dt(&wakeup, GPIO_DISCONNECTED);
	}
	uart_irq_callback_user_data_set(uart, uart_isr, NULL);
	uart_irq_rx_enable(uart);
	k_thread_start(gnss_boot);
	return 0;
}

void pod_gnss_latest(struct pod_gnss_pvt *pvt)
{
	k_mutex_lock(&pvt_lock, K_FOREVER);
	*pvt = latest;
	k_mutex_unlock(&pvt_lock);
}

const char *pod_gnss_version(void)
{
	return version;
}
