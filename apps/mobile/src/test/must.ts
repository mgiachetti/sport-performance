/** The value, or a failed test when a fixture lookup found nothing. */
export function must<T>(value: T | null | undefined, what = 'value'): T {
  if (value === null || value === undefined) throw new Error(`Expected ${what}`);
  return value;
}
