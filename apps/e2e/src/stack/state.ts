import { readFileSync } from 'node:fs';
import { z } from 'zod';
import { runFiles } from './config.ts';

const localDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'a club day (YYYY-MM-DD)');

/**
 * The injury the stack adds for the run (`fixtures.ts`): an open hold on a
 * player of the rugby coach's categories, whatever day the run is.
 */
const injuryFixtureSchema = z.strictObject({
  playerId: z.uuid(),
  /** Unique per run: the coach's page must never show it. */
  diagnosis: z.string().min(1),
  validFrom: localDate,
  validTo: localDate,
});

/** What the stack tells the tests about the run (`state.json`); nothing secret. */
const runStateSchema = z.strictObject({
  startedAt: z.iso.datetime(),
  /** Last club day of the demo data (today in the club's zone when the stack started). */
  asOf: localDate,
  slug: z.string().min(1),
  seed: z.string().min(1),
  historyDays: z.int().positive(),
  emailDomain: z.string().min(1),
  apiUrl: z.url(),
  webUrl: z.url(),
  injuryFixture: injuryFixtureSchema,
});

export type InjuryFixture = Readonly<z.infer<typeof injuryFixtureSchema>>;
export type RunState = Readonly<z.infer<typeof runStateSchema>>;

export class RunStateError extends Error {
  override readonly name = 'RunStateError';
}

const RESTART_HINT =
  'start it with `pnpm --filter @sport-performance/e2e e2e:stack` (Playwright starts it by itself)';

/** Checks the content of a `state.json`; a stale or foreign one fails with what is wrong. */
export function parseRunState(content: string, file = 'state.json'): RunState {
  let json: unknown;
  try {
    json = JSON.parse(content);
  } catch {
    throw new RunStateError(`${file} is not JSON: ${RESTART_HINT}.`);
  }
  const parsed = runStateSchema.safeParse(json);
  if (!parsed.success) {
    throw new RunStateError(
      `${file} is not the state of this version of the stack (${z.prettifyError(parsed.error)}): restart the stack; ${RESTART_HINT}.`,
    );
  }
  return parsed.data;
}

/** Reads the state of the running stack; fails with a hint when there is none or it is stale. */
export function readRunState(runDir: string): RunState {
  const file = runFiles(runDir).state;
  let content: string;
  try {
    content = readFileSync(file, 'utf8');
  } catch {
    throw new RunStateError(`No end-to-end stack state at ${file}: ${RESTART_HINT}.`);
  }
  return parseRunState(content, file);
}
