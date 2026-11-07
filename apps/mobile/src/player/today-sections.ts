import type { WellnessItem } from '@sport-performance/domain';
import type { RpeSession, TodayWellness } from './today.ts';

/**
 * The order of the player's "Hoy" (B-503), by status: what is pending today
 * first and open (its form ready), then what was blocked (no consent, no
 * stage), then what is done as one collapsed line each, and the secondary
 * rows below. With nothing pending nor blocked and something done, a short
 * "all done" line goes on top. Pure: the screen renders the list as it comes.
 */

/** Today's wellness as the screen gets it (`WellnessSection` of the screen). */
export type TodayWellnessInput =
  | { readonly kind: 'unavailable'; readonly reason: 'no_consent' | 'no_stage' }
  | {
      readonly kind: 'form';
      readonly items: readonly WellnessItem[];
      readonly entry: TodayWellness | null;
    };

export interface TodaySectionsInput {
  readonly wellness: TodayWellnessInput;
  readonly rpe: { readonly allowed: boolean; readonly sessions: readonly RpeSession[] };
  readonly hasNextTestDay: boolean;
  /** The entry points the club offers this player (`null` actions hide them). */
  readonly offers: {
    readonly painReport: boolean;
    readonly externalLoad: boolean;
    readonly menstrualCycle: boolean;
  };
  /** Keys of the done lines the player opened (see {@link sectionKey}). */
  readonly opened: ReadonlySet<string>;
}

export type SecondaryRow =
  'streak' | 'nextTestDay' | 'painReport' | 'externalLoad' | 'menstrualCycle';

export type TodaySection =
  | { readonly kind: 'allDone' }
  | { readonly kind: 'wellnessForm' }
  | { readonly kind: 'rpeForm'; readonly sessionIds: readonly string[] }
  | { readonly kind: 'wellnessBlocked'; readonly reason: 'no_consent' | 'no_stage' }
  | { readonly kind: 'rpeBlocked' }
  | {
      readonly kind: 'done';
      readonly items: readonly DoneItem[];
    }
  | { readonly kind: 'secondary'; readonly rows: readonly SecondaryRow[] };

/** One collapsed line of what is done; `expanded` once the player taps it. */
export type DoneItem =
  | { readonly kind: 'wellness'; readonly key: string; readonly expanded: boolean }
  | {
      readonly kind: 'rpe';
      readonly key: string;
      readonly sessionId: string;
      readonly expanded: boolean;
    }
  /** No session to rate today nor yesterday: one muted line, never a form. */
  | { readonly kind: 'rpeNone'; readonly key: string; readonly expanded: false };

/** The key of a done line, stable across renders (what `opened` holds). */
export function sectionKey(
  item: { readonly kind: 'wellness' } | { readonly kind: 'rpe'; readonly sessionId: string },
): string {
  return item.kind === 'wellness' ? 'wellness' : `rpe:${item.sessionId}`;
}

/** An RPE still to load: its window is open and it has none yet. */
function rpePending(item: RpeSession): boolean {
  return item.canSubmit && item.rpe === null;
}

export function todaySections(input: TodaySectionsInput): TodaySection[] {
  const pending: TodaySection[] = [];
  const blocked: TodaySection[] = [];
  const done: DoneItem[] = [];

  const { wellness } = input;
  const wellnessDone = wellness.kind === 'form' && wellness.entry !== null;
  if (wellness.kind === 'unavailable') {
    blocked.push({ kind: 'wellnessBlocked', reason: wellness.reason });
  } else if (wellness.entry === null) {
    pending.push({ kind: 'wellnessForm' });
  } else {
    const key = sectionKey({ kind: 'wellness' });
    done.push({ kind: 'wellness', key, expanded: input.opened.has(key) });
  }

  if (!input.rpe.allowed) {
    blocked.push({ kind: 'rpeBlocked' });
  } else {
    // Oldest first (as `rpeSessions` sorts them): yesterday's window closes sooner.
    const toLoad = input.rpe.sessions.filter(rpePending);
    if (toLoad.length > 0) {
      pending.push({ kind: 'rpeForm', sessionIds: toLoad.map((item) => item.session.id) });
    }
    for (const item of input.rpe.sessions) {
      if (rpePending(item)) continue;
      const key = sectionKey({ kind: 'rpe', sessionId: item.session.id });
      done.push({ kind: 'rpe', key, sessionId: item.session.id, expanded: input.opened.has(key) });
    }
    if (input.rpe.sessions.length === 0) {
      done.push({ kind: 'rpeNone', key: 'rpe:none', expanded: false });
    }
  }

  const rows: SecondaryRow[] = ['streak'];
  if (input.hasNextTestDay) rows.push('nextTestDay');
  // "¿Te duele algo?" (B-609) follows the check-in: a row here once today's is loaded.
  if (input.offers.painReport && wellnessDone) rows.push('painReport');
  if (input.offers.externalLoad) rows.push('externalLoad');
  if (input.offers.menstrualCycle) rows.push('menstrualCycle');

  const sections: TodaySection[] = [];
  const somethingDone = done.some((item) => item.kind !== 'rpeNone');
  if (pending.length === 0 && blocked.length === 0 && somethingDone) {
    sections.push({ kind: 'allDone' });
  }
  sections.push(...pending, ...blocked);
  if (done.length > 0) sections.push({ kind: 'done', items: done });
  sections.push({ kind: 'secondary', rows });
  return sections;
}
