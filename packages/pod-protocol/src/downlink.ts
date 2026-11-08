import { assertUint, ByteReader, ByteWriter, concatBytes } from './bytes.js';
import {
  BEACON_FIXED_BODY_LENGTH,
  BEACON_HEADER_LENGTH,
  CCM_TAG_LENGTH,
  CHANNELS_PER_NETWORK,
  CONTENTION_SLOT,
  MAX_GRANTS_PER_BEACON,
  MAX_RTCM_FRAGMENT_BODY_LENGTH,
  MESSAGE_TYPES,
  POD_PROTOCOL_VERSION,
  RTCM_HEADER_LENGTH,
  SLOT_GRANT_LENGTH,
  SLOTS_PER_CHANNEL,
  typeByte,
} from './constants.js';
import { checkAesKey, nobleCcmProvider, type CcmProvider } from './crypto.js';
import { fail } from './errors.js';
import { downlinkNonce } from './nonce.js';

export const DOWNLINK_MESSAGE_TYPES = ['beacon', 'config', 'rtcm_fragment'] as const;
export type DownlinkMessageType = (typeof DOWNLINK_MESSAGE_TYPES)[number];

/** LED mode broadcast by the beacon (2 bits; `3` reserved). */
export const LED_MODES = ['normal', 'match', 'off'] as const;
export type LedMode = (typeof LED_MODES)[number];

/** Clear part shared by every downlink header: byte 0, network id, GNSS time, key id. */
export interface DownlinkHeader {
  type: DownlinkMessageType;
  networkId: number;
  /** GPS seconds (since 1980-01-06, no leap seconds, u32) of the start of the 2 s frame: even. */
  gnssTimeS: number;
  /** Epoch of the gateway's beacon key. */
  keyId: number;
}

const DOWNLINK_TYPE_BY_CODE = new Map<number, DownlinkMessageType>(
  DOWNLINK_MESSAGE_TYPES.map((type) => [MESSAGE_TYPES[type], type]),
);

function checkFrameTime(gnssTimeS: number): void {
  assertUint('gnssTimeS', gnssTimeS, 32);
  if (gnssTimeS % 2 !== 0) {
    fail('field_out_of_range', 'gnssTimeS must be the start of a 2 s frame (even GPS second)');
  }
}

/**
 * Reads the clear part of any downlink frame (first 8 B), for the pod to pick
 * the beacon key and for monitoring. Lengths are checked by each decoder.
 */
export function decodeDownlinkHeader(packet: Uint8Array): DownlinkHeader {
  if (packet.length < BEACON_HEADER_LENGTH) {
    fail('invalid_length', 'downlink shorter than its header');
  }
  const reader = new ByteReader(packet.subarray(0, BEACON_HEADER_LENGTH));
  const first = reader.u8();
  if (first >>> 4 !== POD_PROTOCOL_VERSION) {
    fail('unsupported_version', `protocol version ${String(first >>> 4)}`);
  }
  const type = DOWNLINK_TYPE_BY_CODE.get(first & 0x0f);
  if (type === undefined) {
    fail('unknown_type', `downlink type 0x${(first & 0x0f).toString(16)}`);
  }
  const header = { type, networkId: reader.u16(), gnssTimeS: reader.u32(), keyId: reader.u8() };
  checkFrameTime(header.gnssTimeS);
  return header;
}

function encodeDownlinkHeaderInto(
  writer: ByteWriter,
  type: DownlinkMessageType,
  header: Omit<DownlinkHeader, 'type'>,
): void {
  assertUint('networkId', header.networkId, 16);
  checkFrameTime(header.gnssTimeS);
  assertUint('keyId', header.keyId, 8);
  writer
    .u8(typeByte(MESSAGE_TYPES[type]))
    .u16(header.networkId)
    .u32(header.gnssTimeS)
    .u8(header.keyId);
}

// ---------------------------------------------------------------------------
// Beacon
// ---------------------------------------------------------------------------

/**
 * Incremental slot change for one pod. `grant` gives (channel, slot) to the pod;
 * `release` takes it back (the pod stops transmitting there and asks again).
 */
export interface SlotGrant {
  action: 'grant' | 'release';
  podShortId: number;
  /** 0..7, index in the network's channel plan. */
  channel: number;
  /** 1..15 (0 is the contention slot and is never granted). */
  slot: number;
}

export interface Beacon extends Omit<DownlinkHeader, 'type'> {
  /** A staff session is open: pods do not close a tramo for stillness. */
  sessionOpen: boolean;
  ledMode: LedMode;
  /**
   * Channel set of the network (8 × 125 kHz in 915–928 MHz) the gateway picked
   * after listening to other networks' beacons; the pod uses it to find its
   * granted channel. The table of plans is club/gateway configuration.
   */
  channelPlanId: number;
  /** Version of the club config the gateway expects, mod 256. */
  configVersion: number;
  /** Bumps (mod 256) on every staff open or close, so a pod that missed beacons notices. */
  sessionSeq: number;
  /** GPS second of the last staff open/close; `null` = none since the gateway started. */
  sessionTransitionGnssS: number | null;
  /** At most 9, so the beacon stays at 48 B. */
  grants: readonly SlotGrant[];
}

function encodeGrantByte(grant: SlotGrant, index: number): number {
  assertUint(`grants[${String(index)}].channel`, grant.channel, 3);
  if (grant.channel >= CHANNELS_PER_NETWORK) {
    fail('field_out_of_range', 'channel must be 0..7');
  }
  if (
    !Number.isInteger(grant.slot) ||
    grant.slot <= CONTENTION_SLOT ||
    grant.slot >= SLOTS_PER_CHANNEL
  ) {
    fail('field_out_of_range', `grants[${String(index)}].slot must be 1..15`);
  }
  return ((grant.action === 'release' ? 1 : 0) << 7) | (grant.channel << 4) | grant.slot;
}

/**
 * Beacon plaintext (body), after the 8 B clear header:
 *
 * ```
 * 0      flags: session open [0] · LED mode [2..1] · reserved 0 [7..3]
 * 1      channel plan id (u8): which set of 8 × 125 kHz channels the network uses
 * 2      config version (u8)
 * 3      session seq (u8)
 * 4..7   last session transition, GPS s (u32 LE; 0 = none)
 * 8      grant count N (0..9)
 * 9..    N × { pod short id (u16 LE), release [7] · channel [6..4] · slot [3..0] }
 * ```
 */
export function encodeBeaconBody(beacon: Beacon): Uint8Array {
  assertUint('channelPlanId', beacon.channelPlanId, 8);
  assertUint('configVersion', beacon.configVersion, 8);
  assertUint('sessionSeq', beacon.sessionSeq, 8);
  if (beacon.sessionTransitionGnssS !== null) {
    assertUint('sessionTransitionGnssS', beacon.sessionTransitionGnssS, 32);
    if (beacon.sessionTransitionGnssS === 0) {
      fail('field_out_of_range', 'sessionTransitionGnssS 0 is the "none" sentinel');
    }
  }
  if (beacon.grants.length > MAX_GRANTS_PER_BEACON) {
    fail('field_out_of_range', `at most ${String(MAX_GRANTS_PER_BEACON)} grants per beacon`);
  }
  const led = LED_MODES.indexOf(beacon.ledMode);
  if (led < 0) {
    fail('field_out_of_range', `unknown ledMode ${beacon.ledMode}`);
  }
  const writer = new ByteWriter(BEACON_FIXED_BODY_LENGTH + beacon.grants.length * SLOT_GRANT_LENGTH)
    .u8((beacon.sessionOpen ? 1 : 0) | (led << 1))
    .u8(beacon.channelPlanId)
    .u8(beacon.configVersion)
    .u8(beacon.sessionSeq)
    .u32(beacon.sessionTransitionGnssS ?? 0)
    .u8(beacon.grants.length);
  beacon.grants.forEach((grant, index) => {
    assertUint(`grants[${String(index)}].podShortId`, grant.podShortId, 16);
    writer.u16(grant.podShortId).u8(encodeGrantByte(grant, index));
  });
  return writer.finish();
}

export function decodeBeaconBody(header: DownlinkHeader, body: Uint8Array): Beacon {
  const reader = new ByteReader(body);
  const flags = reader.u8();
  if ((flags & 0xf8) !== 0) {
    fail('reserved_bits_set', 'reserved bits of the beacon flags must be 0');
  }
  const ledMode = LED_MODES[(flags >>> 1) & 0x03];
  if (ledMode === undefined) {
    fail('field_out_of_range', 'LED mode 3 is reserved');
  }
  const channelPlanId = reader.u8();
  const configVersion = reader.u8();
  const sessionSeq = reader.u8();
  const transition = reader.u32();
  const count = reader.u8();
  if (count > MAX_GRANTS_PER_BEACON) {
    fail('field_out_of_range', `beacon with ${String(count)} grants`);
  }
  if (reader.remaining !== count * SLOT_GRANT_LENGTH) {
    fail('invalid_length', `beacon body does not match its ${String(count)} grants`);
  }
  const grants: SlotGrant[] = [];
  for (let i = 0; i < count; i += 1) {
    const podShortId = reader.u16();
    const byte = reader.u8();
    const slot = byte & 0x0f;
    if (slot === CONTENTION_SLOT) {
      fail('field_out_of_range', 'slot 0 is the contention slot');
    }
    grants.push({
      action: byte & 0x80 ? 'release' : 'grant',
      podShortId,
      channel: (byte >>> 4) & 0x07,
      slot,
    });
  }
  reader.end();
  return {
    networkId: header.networkId,
    gnssTimeS: header.gnssTimeS,
    keyId: header.keyId,
    sessionOpen: (flags & 1) === 1,
    ledMode,
    channelPlanId,
    configVersion,
    sessionSeq,
    sessionTransitionGnssS: transition === 0 ? null : transition,
    grants,
  };
}

/** Nonce of a downlink frame from its first bytes: one per (network, frame time, type byte, fragment). */
function nonceFor(
  type: DownlinkMessageType,
  header: Omit<DownlinkHeader, 'type'>,
  fragmentIndex: number,
): Uint8Array {
  return downlinkNonce({
    networkId: header.networkId,
    gnssTimeS: header.gnssTimeS,
    typeByte: typeByte(MESSAGE_TYPES[type]),
    fragmentIndex,
  });
}

/** Beacon frame: 8 B clear header ‖ CCM(body) ‖ MIC, 21 + 3·N B (≤ 48 B). */
export async function sealBeacon(input: {
  beacon: Beacon;
  key: Uint8Array;
  crypto?: CcmProvider;
}): Promise<Uint8Array> {
  checkAesKey(input.key);
  const headerWriter = new ByteWriter(BEACON_HEADER_LENGTH);
  encodeDownlinkHeaderInto(headerWriter, 'beacon', input.beacon);
  const header = headerWriter.finish();
  const sealed = await (input.crypto ?? nobleCcmProvider).seal({
    key: input.key,
    nonce: nonceFor('beacon', input.beacon, 0),
    aad: header,
    plaintext: encodeBeaconBody(input.beacon),
    tagLength: CCM_TAG_LENGTH,
  });
  return concatBytes(header, sealed);
}

export async function openBeacon(input: {
  packet: Uint8Array;
  key: Uint8Array;
  crypto?: CcmProvider;
}): Promise<Beacon> {
  checkAesKey(input.key);
  const header = decodeDownlinkHeader(input.packet);
  if (header.type !== 'beacon') {
    fail('unexpected_type', `expected a beacon, got ${header.type}`);
  }
  const minimum = BEACON_HEADER_LENGTH + BEACON_FIXED_BODY_LENGTH + CCM_TAG_LENGTH;
  if (input.packet.length < minimum || (input.packet.length - minimum) % SLOT_GRANT_LENGTH !== 0) {
    fail('invalid_length', `beacon of ${String(input.packet.length)} B`);
  }
  const body = await (input.crypto ?? nobleCcmProvider).open({
    key: input.key,
    nonce: nonceFor('beacon', header, 0),
    aad: input.packet.subarray(0, BEACON_HEADER_LENGTH),
    sealed: input.packet.subarray(BEACON_HEADER_LENGTH),
    tagLength: CCM_TAG_LENGTH,
  });
  if (body === null) {
    fail('authentication_failed', 'beacon MIC does not verify');
  }
  return decodeBeaconBody(header, body);
}

// ---------------------------------------------------------------------------
// RTCM fragment
// ---------------------------------------------------------------------------

/**
 * One fragment of the RTCM corrections of a frame. Header (10 B, AAD):
 * byte 0, network id (u16 LE), GNSS time (u32 LE), key id, fragment index,
 * fragment count. Body: up to 241 B of the RTCM stream, encrypted.
 */
export interface RtcmFragment extends Omit<DownlinkHeader, 'type'> {
  fragmentIndex: number;
  fragmentCount: number;
  data: Uint8Array;
}

export async function sealRtcmFragment(input: {
  fragment: RtcmFragment;
  key: Uint8Array;
  crypto?: CcmProvider;
}): Promise<Uint8Array> {
  checkAesKey(input.key);
  const { fragment } = input;
  assertUint('fragmentIndex', fragment.fragmentIndex, 8);
  assertUint('fragmentCount', fragment.fragmentCount, 8);
  if (fragment.fragmentCount === 0 || fragment.fragmentIndex >= fragment.fragmentCount) {
    fail('field_out_of_range', 'fragmentIndex must be below fragmentCount (≥ 1)');
  }
  if (fragment.data.length === 0 || fragment.data.length > MAX_RTCM_FRAGMENT_BODY_LENGTH) {
    fail(
      'invalid_length',
      `RTCM fragment body must be 1..${String(MAX_RTCM_FRAGMENT_BODY_LENGTH)} B`,
    );
  }
  const writer = new ByteWriter(RTCM_HEADER_LENGTH);
  encodeDownlinkHeaderInto(writer, 'rtcm_fragment', fragment);
  const header = writer.u8(fragment.fragmentIndex).u8(fragment.fragmentCount).finish();
  const sealed = await (input.crypto ?? nobleCcmProvider).seal({
    key: input.key,
    nonce: nonceFor('rtcm_fragment', fragment, fragment.fragmentIndex),
    aad: header,
    plaintext: fragment.data,
    tagLength: CCM_TAG_LENGTH,
  });
  return concatBytes(header, sealed);
}

export async function openRtcmFragment(input: {
  packet: Uint8Array;
  key: Uint8Array;
  crypto?: CcmProvider;
}): Promise<RtcmFragment> {
  checkAesKey(input.key);
  const header = decodeDownlinkHeader(input.packet);
  if (header.type !== 'rtcm_fragment') {
    fail('unexpected_type', `expected an RTCM fragment, got ${header.type}`);
  }
  const bodyLength = input.packet.length - RTCM_HEADER_LENGTH - CCM_TAG_LENGTH;
  if (bodyLength < 1 || bodyLength > MAX_RTCM_FRAGMENT_BODY_LENGTH) {
    fail('invalid_length', `RTCM fragment of ${String(input.packet.length)} B`);
  }
  const fragmentIndex = input.packet[BEACON_HEADER_LENGTH] ?? 0;
  const fragmentCount = input.packet[BEACON_HEADER_LENGTH + 1] ?? 0;
  if (fragmentCount === 0 || fragmentIndex >= fragmentCount) {
    fail('field_out_of_range', 'fragmentIndex must be below fragmentCount (≥ 1)');
  }
  const data = await (input.crypto ?? nobleCcmProvider).open({
    key: input.key,
    nonce: nonceFor('rtcm_fragment', header, fragmentIndex),
    aad: input.packet.subarray(0, RTCM_HEADER_LENGTH),
    sealed: input.packet.subarray(RTCM_HEADER_LENGTH),
    tagLength: CCM_TAG_LENGTH,
  });
  if (data === null) {
    fail('authentication_failed', 'RTCM fragment MIC does not verify');
  }
  return {
    networkId: header.networkId,
    gnssTimeS: header.gnssTimeS,
    keyId: header.keyId,
    fragmentIndex,
    fragmentCount,
    data,
  };
}
