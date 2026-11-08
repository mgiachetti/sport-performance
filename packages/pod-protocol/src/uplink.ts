import { assertUint, ByteReader, ByteWriter, concatBytes } from './bytes.js';
import {
  BATTERY_UNKNOWN,
  CCM_TAG_LENGTH,
  LIVE_PACKET_LENGTH,
  LIVE_PACKET_NO_POSITION_LENGTH,
  LIVE_PAYLOAD_LENGTH,
  LIVE_PAYLOAD_NO_POSITION_LENGTH,
  MESSAGE_TYPES,
  NO_DISTANCE_DM,
  NO_POSITION_DM,
  NO_SPEED_CM_S,
  POD_PROTOCOL_VERSION,
  SLOT_REQUEST_PACKET_LENGTH,
  typeByte,
  UPLINK_HEADER_LENGTH,
  type UplinkMessageType,
} from './constants.js';
import { bootCounterLow16, reconstructBootCounter } from './counters.js';
import { checkAesKey, nobleCcmProvider, type CcmProvider } from './crypto.js';
import { fail } from './errors.js';
import { linkNonce } from './nonce.js';
import { bootCounterReference, isFresh, recordAccepted, type ReplayState } from './replay.js';

// ---------------------------------------------------------------------------
// Clear header (AAD)
// ---------------------------------------------------------------------------

/**
 * Clear header of every uplink frame (10 B, authenticated as the CCM AAD):
 *
 * ```
 * 0     version (high nibble) | type (low nibble)
 * 1..2  network id (u16 LE)
 * 3..4  pod short id (u16 LE)
 * 5     key id (epoch, u8)
 * 6..7  boot counter, 16 low bits (u16 LE)
 * 8..9  frame number of the boot (u16 LE)
 * ```
 */
export interface UplinkHeader {
  type: UplinkMessageType;
  networkId: number;
  podShortId: number;
  keyId: number;
  bootCounterLow16: number;
  frameNumber: number;
}

const UPLINK_LENGTH_BY_TYPE: Record<UplinkMessageType, number> = {
  live_summary: LIVE_PACKET_LENGTH,
  live_summary_no_position: LIVE_PACKET_NO_POSITION_LENGTH,
  slot_request: SLOT_REQUEST_PACKET_LENGTH,
};

const UPLINK_TYPE_BY_CODE = new Map<number, UplinkMessageType>(
  (Object.keys(UPLINK_LENGTH_BY_TYPE) as UplinkMessageType[]).map((type) => [
    MESSAGE_TYPES[type],
    type,
  ]),
);

export function encodeUplinkHeader(header: UplinkHeader): Uint8Array {
  assertUint('networkId', header.networkId, 16);
  assertUint('podShortId', header.podShortId, 16);
  assertUint('keyId', header.keyId, 8);
  assertUint('bootCounterLow16', header.bootCounterLow16, 16);
  assertUint('frameNumber', header.frameNumber, 16);
  return new ByteWriter(UPLINK_HEADER_LENGTH)
    .u8(typeByte(MESSAGE_TYPES[header.type]))
    .u16(header.networkId)
    .u16(header.podShortId)
    .u8(header.keyId)
    .u16(header.bootCounterLow16)
    .u16(header.frameNumber)
    .finish();
}

/**
 * Reads the clear header without any key: what the gateway's edge service and
 * the tablet use to filter by network and pick the pod's key. Also checks that
 * the packet length is exactly the one of its type.
 */
export function decodeUplinkHeader(packet: Uint8Array): UplinkHeader {
  if (packet.length < UPLINK_HEADER_LENGTH) {
    fail('invalid_length', `uplink shorter than its ${String(UPLINK_HEADER_LENGTH)} B header`);
  }
  const reader = new ByteReader(packet.subarray(0, UPLINK_HEADER_LENGTH));
  const first = reader.u8();
  const version = first >>> 4;
  if (version !== POD_PROTOCOL_VERSION) {
    fail('unsupported_version', `protocol version ${String(version)}`);
  }
  const type = UPLINK_TYPE_BY_CODE.get(first & 0x0f);
  if (type === undefined) {
    fail('unknown_type', `uplink type 0x${(first & 0x0f).toString(16)}`);
  }
  if (packet.length !== UPLINK_LENGTH_BY_TYPE[type]) {
    fail(
      'invalid_length',
      `${type} must be ${String(UPLINK_LENGTH_BY_TYPE[type])} B, got ${String(packet.length)} B`,
    );
  }
  return {
    type,
    networkId: reader.u16(),
    podShortId: reader.u16(),
    keyId: reader.u8(),
    bootCounterLow16: reader.u16(),
    frameNumber: reader.u16(),
  };
}

// ---------------------------------------------------------------------------
// Encrypted payload of the live summary
// ---------------------------------------------------------------------------

/** GNSS fix quality, 3 bits. `7` is reserved and rejected. */
export const FIX_QUALITIES = [
  'no_fix',
  'dead_reckoning',
  'fix_2d',
  'fix_3d',
  'dgnss',
  'rtk_float',
  'rtk_fixed',
] as const;
export type FixQuality = (typeof FIX_QUALITIES)[number];

export interface PositionDm {
  /** East of the session origin, decimetres. */
  xDm: number;
  /** North of the session origin, decimetres. */
  yDm: number;
}

/** One of the two per-second summaries. `null` = no value that second (no fix, no Doppler). */
export interface LiveSecond {
  vmaxCmS: number | null;
  distanceDm: number | null;
  /** Always `null` in `live_summary_no_position`. */
  positionDm: PositionDm | null;
}

/**
 * Live summary (ADR 0106). Cumulative counters are since the start of the
 * session seen by the pod; they **saturate** at their maximum, never wrap.
 * A lost packet only delays the numbers: the next one brings them complete.
 */
export interface LiveSummary {
  /** 0..100 %, `null` = unknown (MAX17048 not ready). */
  batteryPct: number | null;
  /** Hall sensor of the vest. */
  vestOn: boolean;
  fixQuality: FixQuality;
  /** u24, decimetres (≤ 1 677 km). */
  sessionDistanceDm: number;
  /** Distance in each of the 4 speed bands of the applied config, metres (u16 each). */
  speedBandDistancesM: readonly [number, number, number, number];
  /** u16 each, over the acceleration threshold of the applied config. */
  accelerationsN: number;
  decelerationsN: number;
  /** u24, hundredths of AU (scale versioned with the algorithm). Never called "PlayerLoad". */
  accelLoadCentiAu: number;
  /** u16. Hockey: sent but ignored, never stored nor shown (ADR 0091). */
  impactsN: number;
  /** Second `t−1` then second `t` of the 2 s frame. */
  seconds: readonly [LiveSecond, LiveSecond];
  /** Version of the club config the pod applied, mod 256. */
  configVersion: number;
}

function encodeStatus(summary: LiveSummary): number {
  const battery = summary.batteryPct ?? BATTERY_UNKNOWN;
  if (summary.batteryPct !== null) {
    assertUint('batteryPct', summary.batteryPct, 7);
    if (summary.batteryPct > 100) {
      fail('field_out_of_range', 'batteryPct must be 0..100');
    }
  }
  const fix = FIX_QUALITIES.indexOf(summary.fixQuality);
  if (fix < 0) {
    fail('field_out_of_range', `unknown fixQuality ${summary.fixQuality}`);
  }
  return (battery << 9) | ((summary.vestOn ? 1 : 0) << 8) | (fix << 5);
}

function decodeStatus(status: number): Pick<LiveSummary, 'batteryPct' | 'vestOn' | 'fixQuality'> {
  if ((status & 0x1f) !== 0) {
    fail('reserved_bits_set', 'reserved bits of the status word must be 0');
  }
  const battery = status >>> 9;
  if (battery > 100 && battery !== BATTERY_UNKNOWN) {
    fail('field_out_of_range', `battery ${String(battery)} %`);
  }
  const fixQuality = FIX_QUALITIES[(status >>> 5) & 0x07];
  if (fixQuality === undefined) {
    fail('field_out_of_range', 'fix quality 7 is reserved');
  }
  return {
    batteryPct: battery === BATTERY_UNKNOWN ? null : battery,
    vestOn: ((status >>> 8) & 1) === 1,
    fixQuality,
  };
}

function encodeOptional(
  name: string,
  value: number | null,
  bits: number,
  sentinel: number,
): number {
  if (value === null) {
    return sentinel;
  }
  assertUint(name, value, bits);
  if (value === sentinel) {
    fail('field_out_of_range', `${name} ${String(value)} is the "no value" sentinel`);
  }
  return value;
}

function encodeCoordinate(name: string, value: number): number {
  if (!Number.isInteger(value) || value <= NO_POSITION_DM || value > 0x7fff) {
    fail('field_out_of_range', `${name} must be an integer in −32767..32767 dm`);
  }
  return value;
}

/**
 * Plaintext layout (37 B with positions, 29 B without):
 *
 * ```
 * 0..1    status (u16 LE): battery % [15..9] (127 = unknown) · vest on [8] · fix quality [7..5] · reserved 0 [4..0]
 * 2..4    session distance (u24 LE, dm)
 * 5..12   distance in speed bands 1..4 (4 × u16 LE, m)
 * 13..14  accelerations (u16 LE)
 * 15..16  decelerations (u16 LE)
 * 17..19  accel_load_au (u24 LE, 0,01 AU)
 * 20..21  impacts (u16 LE)
 * 22..23  vmax of second t−1 (u16 LE, cm/s; 0xFFFF = none)
 * 24..25  vmax of second t   (u16 LE, cm/s; 0xFFFF = none)
 * 26      distance of second t−1 (u8, dm; 0xFF = none)
 * 27      distance of second t   (u8, dm; 0xFF = none)
 * 28..35  [live_summary only] x, y of t−1, x, y of t (4 × i16 LE, dm; −32768 = none)
 * 36 / 28 config version applied (u8)
 * ```
 */
export function encodeLivePayload(
  summary: LiveSummary,
  options: { withPosition: boolean },
): Uint8Array {
  assertUint('sessionDistanceDm', summary.sessionDistanceDm, 24);
  summary.speedBandDistancesM.forEach((distance, index) => {
    assertUint(`speedBandDistancesM[${String(index)}]`, distance, 16);
  });
  assertUint('accelerationsN', summary.accelerationsN, 16);
  assertUint('decelerationsN', summary.decelerationsN, 16);
  assertUint('accelLoadCentiAu', summary.accelLoadCentiAu, 24);
  assertUint('impactsN', summary.impactsN, 16);
  assertUint('configVersion', summary.configVersion, 8);
  // Callers may build the summary from JSON: check the tuple lengths at runtime too.
  const bands: readonly number[] = summary.speedBandDistancesM;
  const seconds: readonly LiveSecond[] = summary.seconds;
  if (bands.length !== 4 || seconds.length !== 2) {
    fail('field_out_of_range', 'live summary has 4 speed bands and 2 seconds');
  }
  const writer = new ByteWriter(
    options.withPosition ? LIVE_PAYLOAD_LENGTH : LIVE_PAYLOAD_NO_POSITION_LENGTH,
  )
    .u16(encodeStatus(summary))
    .u24(summary.sessionDistanceDm);
  for (const distance of summary.speedBandDistancesM) {
    writer.u16(distance);
  }
  writer
    .u16(summary.accelerationsN)
    .u16(summary.decelerationsN)
    .u24(summary.accelLoadCentiAu)
    .u16(summary.impactsN);
  for (const [index, second] of summary.seconds.entries()) {
    writer.u16(
      encodeOptional(`seconds[${String(index)}].vmaxCmS`, second.vmaxCmS, 16, NO_SPEED_CM_S),
    );
  }
  for (const [index, second] of summary.seconds.entries()) {
    writer.u8(
      encodeOptional(`seconds[${String(index)}].distanceDm`, second.distanceDm, 8, NO_DISTANCE_DM),
    );
  }
  for (const [index, second] of summary.seconds.entries()) {
    if (!options.withPosition) {
      if (second.positionDm !== null) {
        fail(
          'field_out_of_range',
          `seconds[${String(index)}].positionDm must be null without positions`,
        );
      }
      continue;
    }
    if (second.positionDm === null) {
      writer.i16(NO_POSITION_DM).i16(NO_POSITION_DM);
    } else {
      writer
        .i16(encodeCoordinate(`seconds[${String(index)}].positionDm.xDm`, second.positionDm.xDm))
        .i16(encodeCoordinate(`seconds[${String(index)}].positionDm.yDm`, second.positionDm.yDm));
    }
  }
  return writer.u8(summary.configVersion).finish();
}

export function decodeLivePayload(
  plaintext: Uint8Array,
  options: { withPosition: boolean },
): LiveSummary {
  const expected = options.withPosition ? LIVE_PAYLOAD_LENGTH : LIVE_PAYLOAD_NO_POSITION_LENGTH;
  if (plaintext.length !== expected) {
    fail(
      'invalid_length',
      `live payload must be ${String(expected)} B, got ${String(plaintext.length)} B`,
    );
  }
  const reader = new ByteReader(plaintext);
  const status = decodeStatus(reader.u16());
  const sessionDistanceDm = reader.u24();
  const speedBandDistancesM = [reader.u16(), reader.u16(), reader.u16(), reader.u16()] as const;
  const accelerationsN = reader.u16();
  const decelerationsN = reader.u16();
  const accelLoadCentiAu = reader.u24();
  const impactsN = reader.u16();
  const vmax = [reader.u16(), reader.u16()];
  const distance = [reader.u8(), reader.u8()];
  const positions: (PositionDm | null)[] = [null, null];
  if (options.withPosition) {
    for (let i = 0; i < 2; i += 1) {
      const xDm = reader.i16();
      const yDm = reader.i16();
      if ((xDm === NO_POSITION_DM) !== (yDm === NO_POSITION_DM)) {
        fail('field_out_of_range', 'position must have both coordinates or none');
      }
      positions[i] = xDm === NO_POSITION_DM ? null : { xDm, yDm };
    }
  }
  const configVersion = reader.u8();
  reader.end();
  const second = (i: 0 | 1): LiveSecond => {
    const v = vmax[i] ?? NO_SPEED_CM_S;
    const d = distance[i] ?? NO_DISTANCE_DM;
    return {
      vmaxCmS: v === NO_SPEED_CM_S ? null : v,
      distanceDm: d === NO_DISTANCE_DM ? null : d,
      positionDm: positions[i] ?? null,
    };
  };
  return {
    ...status,
    sessionDistanceDm,
    speedBandDistancesM,
    accelerationsN,
    decelerationsN,
    accelLoadCentiAu,
    impactsN,
    seconds: [second(0), second(1)],
    configVersion,
  };
}

// ---------------------------------------------------------------------------
// Sealed frames
// ---------------------------------------------------------------------------

export type UplinkMessage =
  | { type: 'live_summary'; summary: LiveSummary }
  | { type: 'live_summary_no_position'; summary: LiveSummary }
  | { type: 'slot_request' };

export interface SealUplinkInput {
  message: UplinkMessage;
  networkId: number;
  podShortId: number;
  keyId: number;
  /** Full 32-bit boot counter: the header carries its 16 low bits, the nonce all of it. */
  bootCounter: number;
  frameNumber: number;
  /** Link key of the pod for `keyId` (AES-128). */
  key: Uint8Array;
  crypto?: CcmProvider;
}

function plaintextOf(message: UplinkMessage): Uint8Array {
  switch (message.type) {
    case 'live_summary':
      return encodeLivePayload(message.summary, { withPosition: true });
    case 'live_summary_no_position':
      return encodeLivePayload(message.summary, { withPosition: false });
    case 'slot_request':
      return new Uint8Array(0);
  }
}

/**
 * Builds a complete uplink frame: header ‖ CCM(payload) ‖ MIC. The pod must
 * send at most **one** uplink per (boot counter, frame number), whatever its
 * type: that pair is the whole nonce.
 */
export async function sealUplink(input: SealUplinkInput): Promise<Uint8Array> {
  checkAesKey(input.key);
  const header = encodeUplinkHeader({
    type: input.message.type,
    networkId: input.networkId,
    podShortId: input.podShortId,
    keyId: input.keyId,
    bootCounterLow16: bootCounterLow16(input.bootCounter),
    frameNumber: input.frameNumber,
  });
  const sealed = await (input.crypto ?? nobleCcmProvider).seal({
    key: input.key,
    nonce: linkNonce({
      bootCounter: input.bootCounter,
      frameNumber: input.frameNumber,
      direction: 'uplink',
    }),
    aad: header,
    plaintext: plaintextOf(input.message),
    tagLength: CCM_TAG_LENGTH,
  });
  return concatBytes(header, sealed);
}

export interface OpenedUplink {
  header: UplinkHeader;
  bootCounter: number;
  message: UplinkMessage;
}

/** Verifies and decrypts one frame with a known full boot counter (no anti-replay). */
export async function openUplink(input: {
  packet: Uint8Array;
  bootCounter: number;
  key: Uint8Array;
  crypto?: CcmProvider;
}): Promise<OpenedUplink> {
  checkAesKey(input.key);
  const header = decodeUplinkHeader(input.packet);
  if (bootCounterLow16(input.bootCounter) !== header.bootCounterLow16) {
    fail('field_out_of_range', 'bootCounter does not match the 16 low bits of the header');
  }
  const plaintext = await (input.crypto ?? nobleCcmProvider).open({
    key: input.key,
    nonce: linkNonce({
      bootCounter: input.bootCounter,
      frameNumber: header.frameNumber,
      direction: 'uplink',
    }),
    aad: input.packet.subarray(0, UPLINK_HEADER_LENGTH),
    sealed: input.packet.subarray(UPLINK_HEADER_LENGTH),
    tagLength: CCM_TAG_LENGTH,
  });
  if (plaintext === null) {
    fail('authentication_failed', 'MIC does not verify');
  }
  const message: UplinkMessage =
    header.type === 'slot_request'
      ? { type: 'slot_request' }
      : header.type === 'live_summary'
        ? { type: 'live_summary', summary: decodeLivePayload(plaintext, { withPosition: true }) }
        : {
            type: 'live_summary_no_position',
            summary: decodeLivePayload(plaintext, { withPosition: false }),
          };
  return { header, bootCounter: input.bootCounter, message };
}

/**
 * Default cap on how far ahead of the reference (last accepted or server hint)
 * a boot counter may jump. A pod boots on every wake from System OFF: 1024 is
 * months of normal use, while a forged frame that passes the 4 B MIC by luck
 * (2^-32 per try) cannot push the window to the end of the 32-bit space and
 * silence the pod for the rest of the epoch.
 */
export const DEFAULT_MAX_BOOT_COUNTER_AHEAD = 1024;

/**
 * What the tablet runs for each packet from the edge service: rebuilds the
 * boot counter, rejects replays, verifies and decrypts, and returns the new
 * anti-replay state (to persist) only when the frame is accepted.
 *
 * Packets of the same pod **must be processed one after the other**: await
 * each call and feed its `replay` into the next. Two concurrent calls with the
 * same state would both pass the freshness check. A frame that arrives after a
 * newer one (for example, what the edge service resends after a reconnection)
 * is rejected as `replay`; the cumulative counters of the newer one already
 * include it.
 */
export async function receiveUplink(input: {
  packet: Uint8Array;
  replay: ReplayState;
  /** Link key of `(podShortId, keyId)`, or `undefined` if the tablet has none (unknown pod or epoch). */
  keyFor: (header: UplinkHeader) => Uint8Array | undefined | Promise<Uint8Array | undefined>;
  /** Last boot counter the server saw for the pod (at the base): first contact, or moves the pod forward. */
  bootCounterHint?: (header: UplinkHeader) => number | undefined;
  /**
   * Largest accepted jump of the boot counter over the reference (default
   * {@link DEFAULT_MAX_BOOT_COUNTER_AHEAD}). The caller can scale it with the
   * time elapsed since the pod was last seen. No cap without a reference.
   */
  maxBootCounterAhead?: number;
  crypto?: CcmProvider;
}): Promise<OpenedUplink & { replay: ReplayState }> {
  const header = decodeUplinkHeader(input.packet);
  const key = await input.keyFor(header);
  if (key === undefined) {
    fail(
      'invalid_key',
      `no link key for pod ${String(header.podShortId)} epoch ${String(header.keyId)}`,
    );
  }
  const reference = bootCounterReference(
    input.replay,
    header.podShortId,
    input.bootCounterHint?.(header),
  );
  const bootCounter = reconstructBootCounter(header.bootCounterLow16, reference);
  const maxAhead = input.maxBootCounterAhead ?? DEFAULT_MAX_BOOT_COUNTER_AHEAD;
  if (reference !== undefined && bootCounter > reference + maxAhead) {
    fail(
      'counter_jump',
      `pod ${String(header.podShortId)}: boot counter ${String(bootCounter - reference)} ahead of the reference`,
    );
  }
  const counter = { bootCounter, frameNumber: header.frameNumber };
  if (!isFresh(input.replay, header.podShortId, header.keyId, counter)) {
    fail('replay', `pod ${String(header.podShortId)}: frame not newer than the last accepted`);
  }
  const opened = await openUplink({
    packet: input.packet,
    bootCounter,
    key,
    ...(input.crypto ? { crypto: input.crypto } : {}),
  });
  return {
    ...opened,
    replay: recordAccepted(input.replay, header.podShortId, header.keyId, counter),
  };
}
