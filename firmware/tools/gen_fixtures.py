#!/usr/bin/env python3
"""Turns the golden fixtures of packages/pod-protocol into a C header for the host tests.

    gen_fixtures.py <fixtures/v1 dir> <output header>

Standard library only. The TypeScript package regenerates the JSON from its own
definitions (`pnpm --filter @sport-performance/pod-protocol fixtures:update`); this
script never edits them, it only reads what the firmware has to reproduce byte for byte.
"""

import json
import sys
from pathlib import Path

FIX = ["no_fix", "dead_reckoning", "fix_2d", "fix_3d", "dgnss", "rtk_float", "rtk_fixed"]
RAW_FORMATS = ["rtcm3_msm7", "rtcm3_msm4", "quectel_raw"]
IMU_SENSORS = ["lsm6dsv320x", "icm42688p", "adxl372"]
IMU_CHANNELS = ["accel_gyro", "high_g"]
BARO_SENSORS = ["bmp581", "dps368"]
ANCHOR_SOURCES = ["gnss_pps", "beacon", "dock"]
MARKER_KINDS = [
    "recording_start",
    "recording_stop",
    "vest_on",
    "vest_off",
    "motion_start",
    "motion_stop",
    "staff_session_open",
    "staff_session_close",
]
START_REASONS = ["undocked", "vest_on", "motion", "command"]
STOP_REASONS = ["docked", "battery_low", "memory_full", "shutdown", "idle_timeout"]
EVENT_CODES = [
    "imu_fifo_overrun",
    "gnss_reset",
    "config_rejected",
    "nand_program_failed",
    "nand_erase_failed",
    "brownout",
    "watchdog",
]
CONSTELLATIONS = ["gps", "glonass", "galileo", "beidou", "qzss", "navic"]
BANDS = ["l1", "l5"]
LED_MODES = ["normal", "match", "off"]
UPLINK_TYPES = {"live_summary": 1, "live_summary_no_position": 2, "slot_request": 3}
RECORD_TYPES = {
    "firmware_info": "POD_REC_FIRMWARE_INFO",
    "config_applied": "POD_REC_CONFIG_APPLIED",
    "gnss_pvt": "POD_REC_GNSS_PVT",
    "gnss_raw": "POD_REC_GNSS_RAW",
    "imu_batch": "POD_REC_IMU_BATCH",
    "baro_batch": "POD_REC_BARO_BATCH",
    "time_anchor": "POD_REC_TIME_ANCHOR",
    "sensor_sync": "POD_REC_SENSOR_SYNC",
    "segment_marker": "POD_REC_SEGMENT_MARKER",
    "health": "POD_REC_HEALTH",
    "radio_tx": "POD_REC_RADIO_TX",
    "event": "POD_REC_EVENT",
}


def code(values, value):
    return values.index(value) + 1


def mask(values, items):
    m = 0
    for item in items:
        m |= 1 << values.index(item)
    return m


def opt(value, sentinel):
    return sentinel if value is None else value


def b(value):
    return "true" if value else "false"


def cstr(text):
    return json.dumps(text)


def hex_bytes(hexstr):
    data = bytes.fromhex(hexstr)
    return "{" + ", ".join(f"0x{x:02x}" for x in data) + "}" if data else "{0}"


class Emitter:
    def __init__(self):
        self.lines = []
        self.counter = 0

    def out(self, text=""):
        self.lines.append(text)

    def name(self, prefix):
        self.counter += 1
        return f"{prefix}_{self.counter}"


def summary_init(s):
    secs = []
    for sec in s["seconds"]:
        pos = sec["positionDm"]
        secs.append(
            "{.vmax_cm_s = %d, .distance_dm = %d, .has_position = %s, .x_dm = %d, .y_dm = %d}"
            % (
                opt(sec["vmaxCmS"], 0xFFFF),
                opt(sec["distanceDm"], 0xFF),
                b(pos is not None),
                pos["xDm"] if pos else 0,
                pos["yDm"] if pos else 0,
            )
        )
    bands = ", ".join(str(x) for x in s["speedBandDistancesM"])
    return (
        "{.battery_pct = %d, .vest_on = %s, .fix_quality = %d, .session_distance_dm = %d, "
        ".speed_band_distance_m = {%s}, .accelerations_n = %d, .decelerations_n = %d, "
        ".accel_load_centi_au = %d, .impacts_n = %d, .seconds = {%s}, .config_version = %d}"
        % (
            opt(s["batteryPct"], 127),
            b(s["vestOn"]),
            FIX.index(s["fixQuality"]),
            s["sessionDistanceDm"],
            bands,
            s["accelerationsN"],
            s["decelerationsN"],
            s["accelLoadCentiAu"],
            s["impactsN"],
            ", ".join(secs),
            s["configVersion"],
        )
    )


def record_init(e, rec):
    """Returns the C initializer of a pod_log_record, emitting its data arrays first."""
    t = rec["type"]
    tick = rec["tick"]
    if t == "unknown":
        arr = e.name("fx_body")
        e.out(f"static const uint8_t {arr}[] = {hex_bytes(rec['bodyHex'])};")
        return "{.type = %d, .tick = %dull, .u.raw = {.body = %s, .body_len = %d}}" % (
            rec["typeCode"],
            tick,
            arr,
            len(rec["bodyHex"]) // 2,
        )
    head = "{.type = %s, .tick = %dull, " % (RECORD_TYPES[t], tick)
    if t == "firmware_info":
        v = rec["firmwareVersion"]
        body = (
            ".u.firmware_info = {.major = %d, .minor = %d, .patch = %d, .build_id = %du, "
            ".hardware_revision = %d, .algorithm_version = %d, .radio_protocol_version = %d, "
            ".log_format_version = %d, .gnss_firmware = %s}"
            % (
                v["major"],
                v["minor"],
                v["patch"],
                rec["firmwareBuildId"],
                rec["hardwareRevision"],
                rec["algorithmVersion"],
                rec["radioProtocolVersion"],
                rec["logFormatVersion"],
                cstr(rec["gnssFirmware"]),
            )
        )
    elif t == "config_applied":
        body = (
            ".u.config_applied = {.config_version = %du, .config_hash = %s, "
            ".gnss_pvt_rate_hz = %d, .gnss_raw_rate_hz = %d, .constellations = 0x%02x, "
            ".bands = 0x%02x}"
            % (
                rec["configVersion"],
                hex_bytes(rec["configHashHex"]),
                rec["gnssPvtRateHz"],
                rec["gnssRawRateHz"],
                mask(CONSTELLATIONS, rec["gnssConstellations"]),
                mask(BANDS, rec["gnssBands"]),
            )
        )
    elif t == "gnss_pvt":
        body = (
            ".u.gnss_pvt = {.gnss_time_ms = %dull, .lat_e7 = %d, .lon_e7 = %d, "
            ".height_ellipsoid_mm = %d, .vel_north_mm_s = %d, .vel_east_mm_s = %d, "
            ".vel_down_mm_s = %d, .ground_speed_mm_s = %d, .heading_centi_deg = %d, "
            ".h_acc_mm = %d, .v_acc_mm = %d, .speed_acc_mm_s = %d, .fix_quality = %d, "
            ".satellites_n = %d}"
            % (
                rec["gnssTimeMs"],
                rec["latE7"],
                rec["lonE7"],
                rec["heightEllipsoidMm"],
                opt(rec["velNorthMmS"], -32768),
                opt(rec["velEastMmS"], -32768),
                opt(rec["velDownMmS"], -32768),
                opt(rec["groundSpeedMmS"], 0xFFFF),
                opt(rec["headingCentiDeg"], 0xFFFF),
                opt(rec["hAccMm"], 0xFFFF),
                opt(rec["vAccMm"], 0xFFFF),
                opt(rec["speedAccMmS"], 0xFFFF),
                FIX.index(rec["fixQuality"]),
                rec["satellitesN"],
            )
        )
    elif t == "gnss_raw":
        arr = e.name("fx_raw")
        e.out(f"static const uint8_t {arr}[] = {hex_bytes(rec['dataHex'])};")
        body = ".u.gnss_raw = {.format = %d, .gnss_time_ms = %dull, .data = %s, .data_len = %d}" % (
            code(RAW_FORMATS, rec["format"]),
            opt(rec["gnssTimeMs"], 0xFFFFFFFFFFFF),
            arr,
            len(rec["dataHex"]) // 2,
        )
    elif t == "imu_batch":
        arr = e.name("fx_imu")
        values = [str(v) for sample in rec["samples"] for v in sample]
        e.out(f"static const int16_t {arr}[] = {{{', '.join(values) if values else '0'}}};")
        body = (
            ".u.imu_batch = {.sensor = %d, .channel = %d, .fifo_overrun = %s, "
            ".impact_burst = %s, .accel_range_g = %d, .gyro_range_dps = %d, "
            ".odr_milli_hz = %du, .sensor_tick_period_ns = %du, .first_sensor_timestamp = %du, "
            ".last_sensor_timestamp = %du, .samples_n = %d, .samples = %s}"
            % (
                code(IMU_SENSORS, rec["sensor"]),
                code(IMU_CHANNELS, rec["channel"]),
                b(rec["fifoOverrun"]),
                b(rec["impactBurst"]),
                rec["accelRangeG"],
                rec["gyroRangeDps"],
                rec["odrMilliHz"],
                rec["sensorTickPeriodNs"],
                rec["firstSensorTimestamp"],
                rec["lastSensorTimestamp"],
                len(rec["samples"]),
                arr,
            )
        )
    elif t == "baro_batch":
        arr = e.name("fx_baro")
        samples = ", ".join(
            "{%du, %d}" % (s["pressureCentiPa"], s["temperatureCentiC"]) for s in rec["samples"]
        )
        e.out(f"static const struct pod_baro_sample {arr}[] = {{{samples or '{0, 0}'}}};")
        body = (
            ".u.baro_batch = {.sensor = %d, .odr_milli_hz = %du, .last_sample_delta_ticks = %du, "
            ".samples_n = %d, .samples = %s}"
            % (
                code(BARO_SENSORS, rec["sensor"]),
                rec["odrMilliHz"],
                rec["lastSampleDeltaTicks"],
                len(rec["samples"]),
                arr,
            )
        )
    elif t == "time_anchor":
        body = (
            ".u.time_anchor = {.source = %d, .sub_tick_ns = %d, .gnss_time_ms = %dull, "
            ".uncertainty_us = %du, .gps_utc_offset_s = %d}"
            % (
                code(ANCHOR_SOURCES, rec["source"]),
                rec["subTickNs"],
                rec["gnssTimeMs"],
                opt(rec["uncertaintyUs"], 0xFFFFFFFF),
                opt(rec["gpsUtcOffsetS"], 0xFF),
            )
        )
    elif t == "sensor_sync":
        body = ".u.sensor_sync = {.sensor = %d, .sub_tick_ns = %d, .sensor_timestamp = %du}" % (
            code(IMU_SENSORS, rec["sensor"]),
            rec["subTickNs"],
            rec["sensorTimestamp"],
        )
    elif t == "segment_marker":
        kind = rec["kind"]
        detail, time = 0, 0
        if kind == "recording_start":
            detail = code(START_REASONS, rec["reason"])
        elif kind == "recording_stop":
            detail = code(STOP_REASONS, rec["reason"])
        elif kind in ("staff_session_open", "staff_session_close"):
            detail, time = rec["sessionSeq"], rec["transitionGnssS"]
        body = ".u.segment_marker = {.kind = %d, .detail = %d, .transition_gnss_s = %du}" % (
            code(MARKER_KINDS, kind),
            detail,
            time,
        )
    elif t == "health":
        body = (
            ".u.health = {.battery_pct = %d, .battery_mv = %d, .battery_temp_centi_c = %d, "
            ".mcu_temp_centi_c = %d, .charge_cycles_n = %d, .bad_blocks_n = %d, "
            ".free_blocks_n = %d, .ecc_corrected_n = %d}"
            % (
                opt(rec["batteryPct"], 127),
                opt(rec["batteryMv"], 0),
                opt(rec["batteryTempCentiC"], -32768),
                opt(rec["mcuTempCentiC"], -32768),
                rec["chargeCyclesN"],
                rec["badBlocksN"],
                rec["freeBlocksN"],
                rec["eccCorrectedN"],
            )
        )
    elif t == "radio_tx":
        body = (
            ".u.radio_tx = {.frame_number = %d, .duration_us = %du, .tx_power_dbm = %d, "
            ".message_type_byte = %d}"
            % (rec["frameNumber"], rec["durationUs"], rec["txPowerDbm"], rec["messageTypeByte"])
        )
    elif t == "event":
        body = ".u.event = {.code = %d, .value = %du}" % (
            code(EVENT_CODES, rec["code"]),
            rec["value"],
        )
    else:
        raise SystemExit(f"unknown record type {t}")
    return head + body + "}"


def emit_records(e, prefix, records):
    inits = [record_init(e, r) for r in records]
    e.out(f"static const struct pod_log_record {prefix}[] = {{")
    for init in inits:
        e.out(f"\t{init},")
    e.out("};")


def emit_pages(e, prefix, pages):
    e.out(f"static const char *const {prefix}[] = {{")
    for page in pages:
        e.out(f"\t{cstr(page['pageHex'])},")
    e.out("};")


def main():
    if len(sys.argv) != 3:
        raise SystemExit(__doc__)
    root = Path(sys.argv[1])
    radio = json.loads((root / "vectors.json").read_text())
    log = json.loads((root / "log-vectors.json").read_text())
    if radio["protocolVersion"] != 1 or log["logFormatVersion"] != 1:
        raise SystemExit("fixtures are not v1: update the firmware with the new format")

    e = Emitter()
    e.out("/* Generated by firmware/tools/gen_fixtures.py from packages/pod-protocol/fixtures/v1. */")
    e.out("/* Do not edit. */")
    e.out("#ifndef POD_FIXTURES_V1_H_")
    e.out("#define POD_FIXTURES_V1_H_")
    e.out("#include <stdbool.h>")
    e.out("#include <stdint.h>")
    e.out('#include "pod/log.h"')
    e.out('#include "pod/radio.h"')
    e.out()

    keys = radio["keys"]
    common = radio["common"]
    e.out(f"#define FX_MASTER_KEY_HEX {cstr(keys['masterKeyHex'])}")
    e.out(f"#define FX_DEVICE_ID_HEX {cstr(keys['deviceIdHex'])}")
    e.out(f"#define FX_GATEWAY_ID_HEX {cstr(keys['gatewayIdHex'])}")
    e.out(f"#define FX_EPOCH {keys['epoch']}")
    e.out(f"#define FX_LINK_KEY_HEX {cstr(keys['linkKeyHex'])}")
    e.out(f"#define FX_BEACON_KEY_HEX {cstr(keys['beaconKeyHex'])}")
    e.out(f"#define FX_NETWORK_ID {common['networkId']}")
    e.out(f"#define FX_POD_SHORT_ID {common['podShortId']}")
    e.out(f"#define FX_KEY_ID {common['keyId']}")
    e.out()

    e.out("struct fx_kdf { const char *label; const char *id_hex; uint8_t epoch; "
          "const char *info_hex; const char *key_hex; };")
    e.out("static const struct fx_kdf fx_kdf[] = {")
    for k in radio["kdf"]:
        e.out("\t{%s, %s, %d, %s, %s}," % (cstr(k["label"]), cstr(k["idHex"]), k["epoch"],
                                           cstr(k["infoHex"]), cstr(k["keyHex"])))
    e.out("};")
    e.out()

    e.out("struct fx_uplink { const char *name; uint32_t boot_counter; uint16_t frame_number; "
          "uint8_t type; struct pod_live_summary summary; const char *nonce_hex; "
          "const char *header_hex; const char *plaintext_hex; const char *packet_hex; };")
    e.out("static const struct fx_uplink fx_uplink[] = {")
    for u in radio["uplink"]:
        msg = u["message"]
        summary = summary_init(msg["summary"]) if "summary" in msg else "{0}"
        e.out("\t{%s, %du, %d, %d, %s, %s, %s, %s, %s}," % (
            cstr(u["name"]), u["bootCounter"], u["frameNumber"], UPLINK_TYPES[msg["type"]],
            summary, cstr(u["nonceHex"]), cstr(u["headerHex"]), cstr(u["plaintextHex"]),
            cstr(u["packetHex"])))
    e.out("};")
    e.out()

    e.out("struct fx_beacon { const char *name; struct pod_beacon beacon; const char *nonce_hex; "
          "const char *plaintext_hex; const char *packet_hex; };")
    e.out("static const struct fx_beacon fx_beacon[] = {")
    for c in radio["beacon"]:
        bc = c["beacon"]
        grants = ", ".join(
            "{.pod_short_id = %d, .release = %s, .channel = %d, .slot = %d}"
            % (g["podShortId"], b(g["action"] == "release"), g["channel"], g["slot"])
            for g in bc["grants"]
        )
        e.out("\t{%s, {.network_id = %d, .gnss_time_s = %du, .key_id = %d, .session_open = %s, "
              ".led_mode = %d, .channel_plan_id = %d, .config_version = %d, .session_seq = %d, "
              ".session_transition_gnss_s = %du, .grants_n = %d, .grants = {%s}}, %s, %s, %s}," % (
                  cstr(c["name"]), bc["networkId"], bc["gnssTimeS"], bc["keyId"],
                  b(bc["sessionOpen"]), LED_MODES.index(bc["ledMode"]), bc["channelPlanId"],
                  bc["configVersion"], bc["sessionSeq"], opt(bc["sessionTransitionGnssS"], 0),
                  len(bc["grants"]), grants or "{0}", cstr(c["nonceHex"]),
                  cstr(c["plaintextHex"]), cstr(c["packetHex"])))
    e.out("};")
    e.out()

    e.out("struct fx_rtcm { const char *name; uint16_t network_id; uint32_t gnss_time_s; "
          "uint8_t key_id; uint8_t fragment_index; uint8_t fragment_count; const char *data_hex; "
          "const char *nonce_hex; const char *packet_hex; };")
    e.out("static const struct fx_rtcm fx_rtcm[] = {")
    for c in radio["rtcm"]:
        f = c["fragment"]
        e.out("\t{%s, %d, %du, %d, %d, %d, %s, %s, %s}," % (
            cstr(c["name"]), f["networkId"], f["gnssTimeS"], f["keyId"], f["fragmentIndex"],
            f["fragmentCount"], cstr(f["dataHex"]), cstr(c["nonceHex"]), cstr(c["packetHex"])))
    e.out("};")
    e.out()

    # Log.
    lkeys = log["keys"]
    e.out(f"#define FX_LOG_MASTER_KEY_HEX {cstr(lkeys['masterKeyHex'])}")
    e.out(f"#define FX_LOG_DEVICE_ID_HEX {cstr(lkeys['deviceIdHex'])}")
    e.out("struct fx_storage_key { uint8_t epoch; const char *info_hex; const char *key_hex; "
          "const char *enc_hex; const char *mac_hex; };")
    e.out("static const struct fx_storage_key fx_storage_keys[] = {")
    for k in lkeys["storage"]:
        e.out("\t{%d, %s, %s, %s, %s}," % (k["epoch"], cstr(k["infoHex"]), cstr(k["keyHex"]),
                                           cstr(k["encKeyHex"]), cstr(k["macKeyHex"])))
    e.out("};")
    e.out()

    emit_records(e, "fx_records", [r["record"] for r in log["records"]])
    e.out("static const char *const fx_records_hex[] = {")
    for r in log["records"]:
        e.out(f"\t{cstr(r['hex'])},")
    e.out("};")
    e.out()

    for prefix, case in (("fx_segment", log["segment"]), ("fx_epoch", log["epochChange"])):
        w = case["writer"]
        e.out(f"#define {prefix.upper()}_BOOT_COUNTER {w['bootCounter']}u")
        e.out(f"#define {prefix.upper()}_SEGMENT_ID {w['segmentId']}u")
        e.out(f"#define {prefix.upper()}_FIRST_PAGE_SEQ {w['firstPageSeq']}u")
        e.out(f"#define {prefix.upper()}_KEY_EPOCH {w['keyEpoch']}")
        if "rotateBeforeRecord" in case:
            e.out(f"#define {prefix.upper()}_ROTATE_BEFORE {case['rotateBeforeRecord']}")
            e.out(f"#define {prefix.upper()}_NEW_KEY_EPOCH {case['newKeyEpoch']}")
        emit_records(e, f"{prefix}_records", case["records"])
        emit_pages(e, f"{prefix}_pages", case["pages"])
        e.out()

    # Recovery close the pod writes at the next boot (damaged.recovery_close).
    case = next(d for d in log["damaged"] if d["name"] == "recovery_close")
    page = next(p for p in case["pages"] if "pageHex" in p and bytes.fromhex(p["pageHex"])[6] & 0x08)
    raw = bytes.fromhex(page["pageHex"])
    e.out(f"#define FX_RECOVERY_KEY_EPOCH {raw[5]}")
    e.out(f"#define FX_RECOVERY_BOOT_COUNTER {int.from_bytes(raw[16:20], 'little')}u")
    e.out(f"#define FX_RECOVERY_SEGMENT_ID {int.from_bytes(raw[20:24], 'little')}u")
    e.out(f"#define FX_RECOVERY_PAGE_SEQ {int.from_bytes(raw[24:28], 'little')}u")
    e.out(f"#define FX_RECOVERY_STREAM_OFFSET {int.from_bytes(raw[28:32], 'little')}u")
    e.out(f"#define FX_RECOVERY_PAGE_HEX {cstr(page['pageHex'])}")
    e.out()

    e.out("#endif /* POD_FIXTURES_V1_H_ */")
    Path(sys.argv[2]).write_text("\n".join(e.lines) + "\n")


if __name__ == "__main__":
    main()
