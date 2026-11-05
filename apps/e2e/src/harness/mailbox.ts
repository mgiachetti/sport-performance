import { readFile } from 'node:fs/promises';
import { runFiles } from '../stack/config.ts';
import { latestSignInCode, parseMailbox, type MailboxEntry } from '../stack/mail.ts';

export class MailboxTimeoutError extends Error {
  override readonly name = 'MailboxTimeoutError';
}

async function entries(runDir: string): Promise<MailboxEntry[]> {
  const content = await readFile(runFiles(runDir).mailbox, 'utf8').catch(() => '');
  return parseMailbox(content);
}

/** Position in the mailbox: take it right before asking for a code. */
export async function mailboxMark(runDir: string): Promise<number> {
  return (await entries(runDir)).length;
}

/**
 * Waits for the sign-in code the API sent to `email` after `mark` (from
 * {@link mailboxMark}). The stack writes the mailbox from the API log, so
 * the code shows up a moment after the API answered.
 */
export async function waitForSignInCode(
  runDir: string,
  email: string,
  mark: number,
  timeoutMs = 15_000,
): Promise<string> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const code = latestSignInCode((await entries(runDir)).slice(mark), email);
    if (code !== null) return code;
    if (Date.now() > deadline) {
      throw new MailboxTimeoutError(`No sign-in code for ${email} in ${runFiles(runDir).mailbox}.`);
    }
    await new Promise((done) => setTimeout(done, 200));
  }
}
