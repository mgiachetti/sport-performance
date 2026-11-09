/*
 * LoRa link on the E22-900M22S (SX1262) through the Zephyr LoRa API.
 *
 * The frame format, nonces and AES-CCM are firmware/lib/src/radio.c (checked
 * against the TypeScript golden fixtures); the slot timing is
 * firmware/lib/src/time_base.c. This file configures the radio and moves frames.
 *
 * Stub status (B-904): radio configuration (SF7, 125 kHz, CR 4/5, 8-symbol
 * preamble, explicit header, CRC) and sealing + sending one uplink are real.
 * TODO: channel plan per `channelPlanId` (frequencies not defined yet), beacon
 * reception in the 120 ms window and slot grants, contention slot request,
 * scheduling the TX on the RTC tick of the slot (pod_tdma_slot_tick), holdover,
 * `radio_tx` records and the power cut sequence of pod-v0.md ("Cortar el E22").
 */
#include <zephyr/drivers/gpio.h>
#include <zephyr/drivers/lora.h>
#include <zephyr/kernel.h>
#include <zephyr/logging/log.h>

#include "pod/radio.h"
#include "pod_app.h"

LOG_MODULE_REGISTER(pod_lora, CONFIG_POD_LOG_LEVEL);

#define USER_NODE DT_PATH(zephyr_user)

#if defined(CONFIG_POD_LORA)
static const struct device *const radio = DEVICE_DT_GET(DT_NODELABEL(lora));
#endif
static const struct gpio_dt_spec lora_en = GPIO_DT_SPEC_GET_OR(USER_NODE, lora_en_gpios, {0});

/* Placeholder until the channel plans exist (B-905): first uplink channel of AU915. */
#define PLACEHOLDER_FREQUENCY_HZ 915200000u
#define CHANNEL_STEP_HZ 200000u
#define TX_POWER_DBM 14

/*
 * TODO(B-904): the link key of the epoch arrives wrapped from the dock (ADR
 * 0106). All zero until then, and pod_uplink_seal refuses an all-zero key.
 */
static uint8_t link_key[16];

int pod_lora_power(bool on)
{
	if (lora_en.port == NULL) {
		return 0; /* DK: the breakout is always powered */
	}
	/*
	 * TODO(B-904): off = finish TX/RX, wait BUSY low, disable SPIM2, pins to
	 * disconnected inputs, then LORA_EN low; on = the reverse plus TCXO and
	 * calibration (pod-v0.md).
	 */
	return gpio_pin_set_dt(&lora_en, on ? 1 : 0);
}

#if defined(CONFIG_POD_LORA)
static int configure(uint8_t channel, bool tx)
{
	struct lora_modem_config cfg = {
		.frequency = PLACEHOLDER_FREQUENCY_HZ + channel * CHANNEL_STEP_HZ,
		.bandwidth = BW_125_KHZ,
		.datarate = SF_7,
		.coding_rate = CR_4_5,
		.preamble_len = 8,
		.tx_power = TX_POWER_DBM,
		.tx = tx,
		.iq_inverted = false,
		.public_network = false,
	};

	return lora_config(radio, &cfg);
}

/** Seals and sends one uplink (live summary, or the slot request when `summary` is NULL). */
int pod_lora_send_uplink(const struct pod_uplink_counters *c,
			 const struct pod_live_summary *summary, bool with_position, uint8_t channel)
{
	uint8_t packet[POD_LIVE_PACKET_LEN];
	int n;
	int rc;

	if (!pod_persist_ready()) {
		return -EACCES; /* boot counter not saved: the nonce could repeat */
	}
	/* POD_ERR_STATE with the all-zero key of an unprovisioned pod: nothing is sent. */
	n = pod_uplink_seal(link_key, c, summary, with_position, packet, sizeof(packet));
	if (n < 0) {
		return n;
	}
	rc = configure(channel, true);
	if (rc == 0) {
		rc = lora_send(radio, packet, (uint32_t)n);
	}
	return rc;
}
#endif

int pod_lora_init(void)
{
	if (lora_en.port != NULL) {
		(void)gpio_pin_configure_dt(&lora_en, GPIO_OUTPUT_INACTIVE);
	}
#if defined(CONFIG_POD_LORA)
	if (!device_is_ready(radio)) {
		return -ENODEV;
	}
	return configure(0, false);
#else
	return -ENOTSUP;
#endif
}
