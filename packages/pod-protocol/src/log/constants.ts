/**
 * NAND log of the pod, format v1 (ADR 0106, "Log en la NAND y contrato de
 * ingesta"). Every multi-byte integer is **little-endian**, like the radio.
 */

/** Format version of a log page (byte 4 of the header). `0` is invalid. */
export const LOG_FORMAT_VERSION = 1;

/** ASCII "SPLG": first 4 bytes of every programmed log page. */
export const LOG_PAGE_MAGIC = Uint8Array.of(0x53, 0x50, 0x4c, 0x47);

/** Data area of a W25N page. The spare area (ECC and bad-block marker) is not used by the format. */
export const LOG_PAGE_SIZE = 2048;
export const LOG_PAGE_HEADER_LENGTH = 40;
/** AES-CMAC truncated to 8 B (ADR 0106). */
export const LOG_PAGE_MAC_LENGTH = 8;
export const LOG_PAGE_CRC_LENGTH = 4;
/** Encrypted payload area of a page: 2048 − 40 − 8 − 4. */
export const LOG_PAGE_PAYLOAD_CAPACITY =
  LOG_PAGE_SIZE - LOG_PAGE_HEADER_LENGTH - LOG_PAGE_MAC_LENGTH - LOG_PAGE_CRC_LENGTH;
/** Offset of the MAC (after header and ciphertext) and of the CRC32. */
export const LOG_PAGE_MAC_OFFSET = LOG_PAGE_HEADER_LENGTH + LOG_PAGE_PAYLOAD_CAPACITY;
export const LOG_PAGE_CRC_OFFSET = LOG_PAGE_MAC_OFFSET + LOG_PAGE_MAC_LENGTH;

/** `firstRecordOffset` when no record starts in the page (it only continues one). */
export const NO_RECORD_START = 0xffff;

/** Page flags (byte 6). Bits 7..4 are reserved and must be 0. */
export const PAGE_FLAGS = {
  /** First page of a recording segment (stream offset 0). */
  segmentStart: 0x01,
  /** Last page of a recording segment: the segment was closed cleanly. */
  segmentEnd: 0x02,
  /** The last record of the page continues on the next page of the stream. */
  continues: 0x04,
  /**
   * Closing page the pod wrote at the next boot for a segment a power loss
   * left open (with `segmentEnd`): the segment is final, authenticated by the
   * pod itself.
   */
  recovered: 0x08,
} as const;
export const PAGE_FLAGS_RESERVED_MASK = 0xf0;

/** Erased NAND reads as 0xFF. */
export const ERASED_BYTE = 0xff;

/**
 * NAND geometry. The W25N04KV / W25N02KV have 2048 B pages (plus a spare area
 * the internal ECC uses) and 64 pages per block (ADR 0106, docs/hardware/pod-v0.md).
 */
export interface NandGeometry {
  readonly name: string;
  readonly pageSizeB: number;
  readonly pagesPerBlock: number;
  readonly blocks: number;
  /**
   * Blocks the firmware keeps for its segment index (a cache: it can be rebuilt
   * by scanning). They hold no log pages.
   */
  readonly reservedBlocks: number;
  /**
   * Bad blocks to budget for over the life of the chip (factory plus grown).
   * **Not verified** against the Winbond datasheet: ~2 % (82 of 4096).
   */
  readonly badBlockAllowance: number;
}

export const W25N04KV: NandGeometry = {
  name: 'W25N04KV',
  pageSizeB: LOG_PAGE_SIZE,
  pagesPerBlock: 64,
  blocks: 4096,
  reservedBlocks: 8,
  badBlockAllowance: 82,
};

export const W25N02KV: NandGeometry = {
  name: 'W25N02KV',
  pageSizeB: LOG_PAGE_SIZE,
  pagesPerBlock: 64,
  blocks: 2048,
  reservedBlocks: 8,
  badBlockAllowance: 41,
};

/** RTC of the nRF52840 on the 32,768 kHz crystal (LFXO): 1 tick ≈ 30,52 µs. */
export const RTC_TICK_HZ = 32_768;
/** Crystal tolerance used to bound drift and reject bad anchors (ADR 0106: ±20 ppm). */
export const RTC_TOLERANCE_PPM = 20;
/**
 * Two anchors agree if the rate between them is within this of nominal
 * (beyond both uncertainties). The crystal is ±20 ppm; 100 ppm leaves room for
 * temperature and ageing while a GNSS time step of 1 s is caught between
 * anchors up to 10 000 s apart.
 */
export const ANCHOR_MAX_RATE_ERROR_PPM = 100;
/** A link of the consensus chain skips at most this many anchors (cost O(n · K)). */
export const ANCHOR_LOOKBACK = 64;
/**
 * A stretch after a step needs this many anchors, or at least 3 spanning
 * `ANCHOR_STRETCH_MIN_TICKS`; fewer are rejected.
 */
export const ANCHOR_STRETCH_MIN = 10;
export const ANCHOR_STRETCH_MIN_TICKS = 30 * RTC_TICK_HZ;
/** Time stretches per boot at most; anchors beyond are rejected (`too_many_stretches`). */
export const MAX_TIME_STRETCHES = 16;

/** GPS epoch (06/01/1980 00:00:00 UTC) in Unix milliseconds. */
export const GPS_EPOCH_UNIX_MS = 315_964_800_000;
/** GPS − UTC (leap seconds) since 01/01/2017; anchors carry the value they saw. */
export const DEFAULT_GPS_UTC_OFFSET_S = 18;

/** Sentinels. */
export const NO_GNSS_TIME_MS = 0xffff_ffff_ffff;
export const UNKNOWN_U16 = 0xffff;
export const UNKNOWN_U32 = 0xffff_ffff;
export const UNKNOWN_I16 = -0x8000;
export const UNKNOWN_U8 = 0xff;
