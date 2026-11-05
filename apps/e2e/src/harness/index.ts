/**
 * `@sport-performance/e2e/harness`: what a test needs to talk to the running
 * end-to-end stack (ADR 0096), from Playwright and from the mobile
 * end-to-end tests: where it is, its state, its mailbox (sign-in codes) and
 * the demo dataset it seeded.
 */
export { E2E_DEMO_SLUG, stackEndpoints, type StackEndpoints } from '../stack/config.ts';
export { readRunState, RunStateError, type InjuryFixture, type RunState } from '../stack/state.ts';
export { mailboxMark, waitForSignInCode, MailboxTimeoutError } from './mailbox.ts';
export {
  DEMO_ACCOUNTS,
  activePlayers,
  categoryOn,
  childrenOf,
  coachRugbySeniorScope,
  demoDataset,
  demoEmail,
  recentlyHeldPlayers,
  rosterName,
  userByEmail,
  type DemoAccount,
} from './demo.ts';
