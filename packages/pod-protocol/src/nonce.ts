import { assertUint, ByteWriter } from './bytes.js';
import { CCM_NONCE_LENGTH, LINK_DIRECTION, type LinkDirection } from './constants.js';

/**
 * Link nonce (ADR 0106): 32-bit boot counter (4 B) + frame number (2 B) +
 * direction (1 B) = 7 B, zero-padded to 13 B. Little-endian.
 *
 * ```
 * 0..3  boot counter (u32 LE, full 32 bits, not the 16 low bits of the header)
 * 4..5  frame number (u16 LE)
 * 6     direction (0x00 pod → gateway, 0x01 gateway → pod)
 * 7..12 0x00
 * ```
 */
export function linkNonce(input: {
  bootCounter: number;
  frameNumber: number;
  direction: LinkDirection;
}): Uint8Array {
  assertUint('bootCounter', input.bootCounter, 32);
  assertUint('frameNumber', input.frameNumber, 16);
  const writer = new ByteWriter(CCM_NONCE_LENGTH)
    .u32(input.bootCounter)
    .u16(input.frameNumber)
    .u8(LINK_DIRECTION[input.direction]);
  return writer.bytes;
}

/**
 * Beacon / downlink nonce (ADR 0106): network id (2 B) + full GNSS time of the
 * frame (4 B) + message type (1 B) + fragment index (1 B), zero-padded to 13 B.
 *
 * The "message type" byte is the **whole byte 0 of the frame** (version nibble
 * and type nibble), so a future protocol version under the same beacon key
 * never shares a nonce with this one.
 */
export function downlinkNonce(input: {
  networkId: number;
  gnssTimeS: number;
  typeByte: number;
  fragmentIndex: number;
}): Uint8Array {
  assertUint('networkId', input.networkId, 16);
  assertUint('gnssTimeS', input.gnssTimeS, 32);
  assertUint('typeByte', input.typeByte, 8);
  assertUint('fragmentIndex', input.fragmentIndex, 8);
  const writer = new ByteWriter(CCM_NONCE_LENGTH)
    .u16(input.networkId)
    .u32(input.gnssTimeS)
    .u8(input.typeByte)
    .u8(input.fragmentIndex);
  return writer.bytes;
}
