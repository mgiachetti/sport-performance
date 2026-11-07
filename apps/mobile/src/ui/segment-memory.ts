/**
 * The selected segment of each screen for the app session (ADR 0104): leaving
 * "Mis tests" on "Historial" and coming back finds it there. In memory only,
 * keyed by the screen and its scope (the membership, and the session of a
 * coach's sheet), so another club starts fresh; signing out forgets it all.
 * Plain TypeScript, so the session controller clears it without React.
 */
const remembered = new Map<string, string>();

/** The key of a screen's tabs in one scope (`null` before choosing a club). */
export function segmentKey(screen: string, scope: string | null | undefined): string {
  return `${scope ?? '-'}:${screen}`;
}

export function rememberedSegment(key: string): string | undefined {
  return remembered.get(key);
}

export function rememberSegment(key: string, value: string): void {
  remembered.set(key, value);
}

/** Forgets every remembered segment: on sign-out, and between tests. */
export function forgetRememberedSegments(): void {
  remembered.clear();
}
