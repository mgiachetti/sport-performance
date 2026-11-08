/**
 * Protocol constants (ADR 0106, "Protocolo LoRa"). The version nibble changes
 * only with an incompatible layout; a new message type keeps the version.
 */

/** Version nibble of every frame in this package. `0` is invalid on the air. */
export const POD_PROTOCOL_VERSION = 1;

/** Message types (low nibble of byte 0). 0x1–0x7 are pod → gateway, 0x8–0xF gateway → pod. */
export const MESSAGE_TYPES = {
  /** Live summary with the two per-second positions (club opted in). 51 B. */
  live_summary: 0x1,
  /** Live summary without positions (club did not opt in). 43 B. */
  live_summary_no_position: 0x2,
  /** Slot request sent in the contention slot: header + MIC only. 14 B. */
  slot_request: 0x3,
  /** Beacon at the start of each 2 s frame, on the first channel of the network plan. */
  beacon: 0x8,
  /** Versioned club configuration (body not specified yet; reserved). */
  config: 0x9,
  /** Authenticated RTCM fragment. */
  rtcm_fragment: 0xa,
} as const;

export type MessageType = keyof typeof MESSAGE_TYPES;

/** Byte 0 of a frame: version nibble ‖ type nibble. */
export function typeByte(code: number): number {
  return (POD_PROTOCOL_VERSION << 4) | code;
}

export const UPLINK_MESSAGE_TYPES = [
  'live_summary',
  'live_summary_no_position',
  'slot_request',
] as const;
export type UplinkMessageType = (typeof UPLINK_MESSAGE_TYPES)[number];

/** Direction byte of the link nonce. */
export const LINK_DIRECTION = { uplink: 0x00, downlink: 0x01 } as const;
export type LinkDirection = keyof typeof LINK_DIRECTION;

/** AES-CCM parameters: 13 B nonce (L = 2) and 4 B MIC. */
export const CCM_NONCE_LENGTH = 13;
export const CCM_TAG_LENGTH = 4;
export const AES_KEY_LENGTH = 16;

/** Clear header (AAD) of an uplink frame. */
export const UPLINK_HEADER_LENGTH = 10;
/** Encrypted payload of a live summary with / without positions. */
export const LIVE_PAYLOAD_LENGTH = 37;
export const LIVE_PAYLOAD_NO_POSITION_LENGTH = 29;
export const LIVE_PACKET_LENGTH = UPLINK_HEADER_LENGTH + LIVE_PAYLOAD_LENGTH + CCM_TAG_LENGTH;
export const LIVE_PACKET_NO_POSITION_LENGTH =
  UPLINK_HEADER_LENGTH + LIVE_PAYLOAD_NO_POSITION_LENGTH + CCM_TAG_LENGTH;
export const SLOT_REQUEST_PACKET_LENGTH = UPLINK_HEADER_LENGTH + CCM_TAG_LENGTH;

/** Clear header (AAD) of a beacon. */
export const BEACON_HEADER_LENGTH = 8;
export const BEACON_FIXED_BODY_LENGTH = 9;
export const SLOT_GRANT_LENGTH = 3;
/** Grants per beacon so the beacon stays at 48 B (≈ 97,5 ms, inside the 120 ms window). */
export const MAX_GRANTS_PER_BEACON = 9;
export const MAX_BEACON_LENGTH =
  BEACON_HEADER_LENGTH +
  BEACON_FIXED_BODY_LENGTH +
  MAX_GRANTS_PER_BEACON * SLOT_GRANT_LENGTH +
  CCM_TAG_LENGTH;

export const RTCM_HEADER_LENGTH = 10;
/** Largest LoRa payload of the SX126x / SX1302. */
export const MAX_LORA_PAYLOAD_LENGTH = 255;
export const MAX_RTCM_FRAGMENT_BODY_LENGTH =
  MAX_LORA_PAYLOAD_LENGTH - RTCM_HEADER_LENGTH - CCM_TAG_LENGTH;

/** TDMA frame (ADR 0106). */
export const FRAME_MS = 2000;
export const BEACON_WINDOW_MS = 120;
export const SLOT_MS = 115;
export const GUARD_MS = 3;
export const CHANNELS_PER_NETWORK = 8;
/** Slot 0 of every channel is the contention slot; 1..15 are granted uplink slots. */
export const CONTENTION_SLOT = 0;
export const SLOTS_PER_CHANNEL = 16;

/** Live radio settings (ADR 0106): SF7, 125 kHz, CR 4/5, explicit header, CRC, 8-symbol preamble. */
export const LIVE_RADIO = {
  spreadingFactor: 7,
  bandwidthHz: 125_000,
  codingRateDenominator: 5,
  preambleSymbols: 8,
  explicitHeader: true,
  crc: true,
} as const;

/** Sentinels for "no value this second". */
export const NO_POSITION_DM = -0x8000;
export const NO_SPEED_CM_S = 0xffff;
export const NO_DISTANCE_DM = 0xff;
export const BATTERY_UNKNOWN = 0x7f;
