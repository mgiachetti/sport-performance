/**
 * Every rejection of the codec carries a stable code, so the tablet, the worker
 * and the firmware conformance tests can assert *why* a packet was rejected
 * without matching on message text.
 */
export const POD_PROTOCOL_ERROR_CODES = [
  'invalid_length',
  'unsupported_version',
  'unknown_type',
  'unexpected_type',
  'field_out_of_range',
  'reserved_bits_set',
  'authentication_failed',
  'replay',
  'counter_jump',
  'boot_counter_exhausted',
  'invalid_key',
] as const;

export type PodProtocolErrorCode = (typeof POD_PROTOCOL_ERROR_CODES)[number];

export class PodProtocolError extends Error {
  readonly code: PodProtocolErrorCode;

  constructor(code: PodProtocolErrorCode, message: string) {
    super(message);
    this.name = 'PodProtocolError';
    this.code = code;
  }
}

export function fail(code: PodProtocolErrorCode, message: string): never {
  throw new PodProtocolError(code, message);
}
