declare const brand: unique symbol;

/**
 * Nominal ("branded") type: structurally a `T`, but not assignable from a plain
 * `T` without going through a parser. Used for values whose validity cannot be
 * expressed by the type system alone (UUIDs, calendar dates, IANA time zones,
 * dictionary codes). Brands are erased at runtime: a branded value serialises
 * exactly like its base type. Brands compose: `Brand<Brand<string, 'Uuid'>, 'ClubId'>`
 * is both a `Uuid` and a `ClubId`, but not a `PlayerId`.
 */
export type Brand<T, B extends string> = T & { readonly [brand]: Readonly<Record<B, true>> };
