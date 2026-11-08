import { fail } from './errors.js';

/**
 * Byte helpers. Every multi-byte integer on the air is **little-endian**
 * (native order of the nRF52840 and the SX1302 HAL, same as LoRaWAN).
 */

export function assertUint(name: string, value: number, bits: number): void {
  const max = 2 ** bits - 1;
  if (!Number.isInteger(value) || value < 0 || value > max) {
    fail(
      'field_out_of_range',
      `${name} must be an integer in 0..${String(max)}, got ${String(value)}`,
    );
  }
}

export function assertIntRange(name: string, value: number, min: number, max: number): void {
  if (!Number.isInteger(value) || value < min || value > max) {
    fail(
      'field_out_of_range',
      `${name} must be an integer in ${String(min)}..${String(max)}, got ${String(value)}`,
    );
  }
}

/** Sequential writer over a fixed-size buffer; overflow is a programming error. */
export class ByteWriter {
  readonly bytes: Uint8Array;
  private offset = 0;

  constructor(length: number) {
    this.bytes = new Uint8Array(length);
  }

  get position(): number {
    return this.offset;
  }

  private reserve(length: number): number {
    const start = this.offset;
    if (start + length > this.bytes.length) {
      fail('invalid_length', `write past the end of a ${String(this.bytes.length)} B buffer`);
    }
    this.offset += length;
    return start;
  }

  u8(value: number): this {
    const at = this.reserve(1);
    this.bytes[at] = value & 0xff;
    return this;
  }

  u16(value: number): this {
    const at = this.reserve(2);
    this.bytes[at] = value & 0xff;
    this.bytes[at + 1] = (value >>> 8) & 0xff;
    return this;
  }

  u24(value: number): this {
    const at = this.reserve(3);
    this.bytes[at] = value & 0xff;
    this.bytes[at + 1] = (value >>> 8) & 0xff;
    this.bytes[at + 2] = (value >>> 16) & 0xff;
    return this;
  }

  u32(value: number): this {
    const at = this.reserve(4);
    this.bytes[at] = value & 0xff;
    this.bytes[at + 1] = (value >>> 8) & 0xff;
    this.bytes[at + 2] = (value >>> 16) & 0xff;
    this.bytes[at + 3] = (value >>> 24) & 0xff;
    return this;
  }

  /** 48-bit unsigned (exact in a JS number): ticks and milliseconds of the NAND log. */
  u48(value: number): this {
    const low = value % 0x1_0000_0000;
    this.u32(low);
    return this.u16(Math.floor(value / 0x1_0000_0000));
  }

  /** Two's complement 8-bit. */
  i8(value: number): this {
    return this.u8(value < 0 ? value + 0x100 : value);
  }

  /** Two's complement 16-bit. */
  i16(value: number): this {
    return this.u16(value < 0 ? value + 0x10000 : value);
  }

  /** Two's complement 32-bit. */
  i32(value: number): this {
    return this.u32(value < 0 ? value + 0x1_0000_0000 : value);
  }

  raw(value: Uint8Array): this {
    const at = this.reserve(value.length);
    this.bytes.set(value, at);
    return this;
  }

  finish(): Uint8Array {
    if (this.offset !== this.bytes.length) {
      fail(
        'invalid_length',
        `buffer of ${String(this.bytes.length)} B filled only to ${String(this.offset)} B`,
      );
    }
    return this.bytes;
  }
}

/** Sequential reader; reading past the end rejects the packet as `invalid_length`. */
export class ByteReader {
  private offset = 0;

  constructor(private readonly bytes: Uint8Array) {}

  get remaining(): number {
    return this.bytes.length - this.offset;
  }

  get position(): number {
    return this.offset;
  }

  private take(length: number): number {
    const start = this.offset;
    if (start + length > this.bytes.length) {
      fail('invalid_length', `read past the end of a ${String(this.bytes.length)} B buffer`);
    }
    this.offset += length;
    return start;
  }

  private at(index: number): number {
    // `take` already checked the bounds.
    return this.bytes[index] ?? 0;
  }

  u8(): number {
    return this.at(this.take(1));
  }

  u16(): number {
    const i = this.take(2);
    return this.at(i) | (this.at(i + 1) << 8);
  }

  u24(): number {
    const i = this.take(3);
    return this.at(i) | (this.at(i + 1) << 8) | (this.at(i + 2) << 16);
  }

  u32(): number {
    const i = this.take(4);
    return (
      (this.at(i) | (this.at(i + 1) << 8) | (this.at(i + 2) << 16) | (this.at(i + 3) << 24)) >>> 0
    );
  }

  u48(): number {
    const low = this.u32();
    return low + this.u16() * 0x1_0000_0000;
  }

  i8(): number {
    const value = this.u8();
    return value >= 0x80 ? value - 0x100 : value;
  }

  i16(): number {
    const value = this.u16();
    return value >= 0x8000 ? value - 0x10000 : value;
  }

  i32(): number {
    return this.u32() | 0;
  }

  raw(length: number): Uint8Array {
    const i = this.take(length);
    return this.bytes.slice(i, i + length);
  }

  end(): void {
    if (this.remaining !== 0) {
      fail('invalid_length', `${String(this.remaining)} trailing bytes`);
    }
  }
}

export function concatBytes(...parts: readonly Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

const HEX = '0123456789abcdef';

export function toHex(bytes: Uint8Array): string {
  let out = '';
  for (const byte of bytes) {
    out += (HEX[byte >>> 4] ?? '') + (HEX[byte & 0x0f] ?? '');
  }
  return out;
}

export function fromHex(hex: string): Uint8Array {
  const clean = hex.replace(/\s+/g, '').toLowerCase();
  if (clean.length % 2 !== 0 || !/^[0-9a-f]*$/.test(clean)) {
    fail('invalid_length', 'hex string must have an even number of hex digits');
  }
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i += 1) {
    out[i] = Number.parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

/** ASCII only (the KDF labels): no `TextEncoder`, so the core needs no DOM or Node lib. */
export function asciiBytes(text: string): Uint8Array {
  const out = new Uint8Array(text.length);
  for (let i = 0; i < text.length; i += 1) {
    const code = text.charCodeAt(i);
    if (code > 0x7f) {
      fail('field_out_of_range', 'label must be ASCII');
    }
    out[i] = code;
  }
  return out;
}

/** Constant-time comparison for tags. */
export function equalBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) {
    return false;
  }
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) {
    diff |= (a[i] ?? 0) ^ (b[i] ?? 0);
  }
  return diff === 0;
}
