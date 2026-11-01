import { isHexColor, normalizeHex, type HexColor } from './color.js';
import { orcBrand } from './palette.js';

/**
 * A club's brand colors, as stored per tenant and served by the API (B-313).
 * `primary` drives fills, accents and the player series in charts;
 * `secondary` is the second jersey color (ORC: black stripes).
 */
export interface ClubBrand {
  readonly primary: HexColor;
  readonly secondary: HexColor;
}

/** Loose input accepted from configuration or the API; validated by {@link parseClubBrand}. */
export interface ClubBrandInput {
  readonly primary: string;
  readonly secondary?: string | undefined;
}

export class InvalidClubBrandError extends Error {
  override readonly name = 'InvalidClubBrandError';
  constructor(
    message: string,
    readonly field?: keyof ClubBrandInput,
  ) {
    super(message);
  }
}

export const defaultBrand: ClubBrand = {
  primary: normalizeHex(orcBrand.primary),
  secondary: normalizeHex(orcBrand.secondary),
};

function parseField(value: unknown, field: keyof ClubBrandInput): HexColor {
  if (!isHexColor(value)) {
    throw new InvalidClubBrandError(
      `Invalid club brand: "${field}" must be a #rgb or #rrggbb color`,
      field,
    );
  }
  return normalizeHex(value);
}

/**
 * Validates and normalizes untrusted brand input (API payload, admin form).
 * `secondary` defaults to the ORC black. Throws {@link InvalidClubBrandError}.
 */
export function parseClubBrand(input: unknown): ClubBrand {
  if (typeof input !== 'object' || input === null) {
    throw new InvalidClubBrandError('Invalid club brand: expected an object');
  }
  const record = input as Record<string, unknown>;
  const primary = parseField(record.primary, 'primary');
  const secondary =
    record.secondary === undefined || record.secondary === null
      ? defaultBrand.secondary
      : parseField(record.secondary, 'secondary');
  return { primary, secondary };
}
