/**
 * Checks of the secrets of the environment (ADR 0031). They run in
 * production at startup; their messages describe the problem, never the value.
 */

/** Below this a production secret is refused: 128 bits, the floor of NIST SP 800-131A. */
export const MIN_SECRET_ENTROPY_BITS = 128;
export const MIN_SECRET_LENGTH = 32;
/** Shortest password of a database login in production (`db:provision-login` makes 32+). */
export const MIN_DATABASE_PASSWORD_LENGTH = 16;

/** Fragments of the example values of `.env.example` and of the usual placeholders. */
const PLACEHOLDER_PATTERNS = [
  /change[-_ ]?me/i,
  /example/i,
  /secret/i,
  /password/i,
  /placeholder/i,
];

/**
 * Estimated entropy of a secret, in bits: its length times the Shannon
 * entropy of its characters. Not a proof of randomness, a floor against
 * the usual mistakes: a word repeated, a short value, few distinct
 * characters. `openssl rand -base64 48` gives ~280 bits; 32 hex chars ~120.
 */
export function estimateEntropyBits(secret: string): number {
  const chars = Array.from(secret);
  if (chars.length === 0) return 0;
  const counts = new Map<string, number>();
  for (const char of chars) counts.set(char, (counts.get(char) ?? 0) + 1);
  let perChar = 0;
  for (const count of counts.values()) {
    const p = count / chars.length;
    perChar -= p * Math.log2(p);
  }
  return perChar * chars.length;
}

/** Problems of a secret for production, as messages without the value; empty when fine. */
export function secretProblems(secret: string): string[] {
  const problems: string[] = [];
  if (secret.length < MIN_SECRET_LENGTH) {
    problems.push(`must be at least ${String(MIN_SECRET_LENGTH)} characters in production`);
  }
  if (estimateEntropyBits(secret) < MIN_SECRET_ENTROPY_BITS) {
    problems.push('looks too predictable: generate it with `openssl rand -base64 48`');
  }
  if (PLACEHOLDER_PATTERNS.some((pattern) => pattern.test(secret))) {
    problems.push('looks like a placeholder or an example value');
  }
  return problems;
}

/** Problems of the password of a `postgres://` URL for production; empty when fine. */
export function databaseUrlProblems(url: string): string[] {
  let password: string;
  try {
    password = decodeURIComponent(new URL(url).password);
  } catch {
    return ['is not a valid URL'];
  }
  if (password === '') return ['needs a password in production'];
  const problems: string[] = [];
  if (password.length < MIN_DATABASE_PASSWORD_LENGTH) {
    problems.push(
      `password must be at least ${String(MIN_DATABASE_PASSWORD_LENGTH)} characters in production`,
    );
  }
  if (PLACEHOLDER_PATTERNS.some((pattern) => pattern.test(password))) {
    problems.push('password looks like a placeholder or an example value');
  }
  return problems;
}
