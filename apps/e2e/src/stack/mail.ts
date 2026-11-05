/**
 * The mailbox of the run. Without `RESEND_API_KEY` the API writes every email
 * to its log (`LogEmailTransport`, `email not sent …`, with `devEmail` and
 * the plain text). The stack reads the API's JSON log lines and keeps the
 * sign-in codes here: the code is stored hashed in the database, and the API
 * has no back door for tests (ADR 0096).
 */

/** Digits of a sign-in code (`SIGN_IN_CODE_LENGTH` of the contracts). */
export const SIGN_IN_CODE_LENGTH = 6;

export interface MailboxEntry {
  /** Recipient, lowercase. */
  readonly to: string;
  readonly kind: string;
  readonly subject: string;
  /** The sign-in code, for `sign_in_code` emails. */
  readonly code: string | null;
  /** Links found in the text (invitations, sign-in links). */
  readonly links: readonly string[];
  /** When the API logged it (epoch ms). */
  readonly at: number;
}

const CODE_LINE = new RegExp(`^\\s*(\\d{${String(SIGN_IN_CODE_LENGTH)}})\\s*$`, 'm');
const ANY_CODE = new RegExp(`(?<![\\d/])(\\d{${String(SIGN_IN_CODE_LENGTH)}})(?![\\d/])`);
const LINK = /https?:\/\/[^\s<>"')\]]+/g;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/**
 * The email of one API log line, or `null` when the line is something else
 * (any other log, or not JSON at all: a stack trace, a pnpm banner).
 */
export function parseMailLogLine(line: string): MailboxEntry | null {
  const trimmed = line.trim();
  if (!trimmed.startsWith('{')) return null;
  let record: unknown;
  try {
    record = JSON.parse(trimmed);
  } catch {
    return null;
  }
  if (!isRecord(record) || !isRecord(record.devEmail)) return null;
  const { kind, recipient, subject } = record.devEmail;
  if (typeof kind !== 'string' || typeof recipient !== 'string') return null;
  const text = typeof record.msg === 'string' ? record.msg : '';
  const body = text.includes('\n') ? text.slice(text.indexOf('\n') + 1) : '';
  // The code is a line of its own in the plain text; any lone 6-digit group is the fallback.
  const code =
    kind === 'sign_in_code'
      ? (CODE_LINE.exec(body)?.[1] ?? ANY_CODE.exec(body)?.[1] ?? null)
      : null;
  return {
    to: recipient.toLowerCase(),
    kind,
    subject: typeof subject === 'string' ? subject : '',
    code,
    links: body.match(LINK) ?? [],
    at: logTime(record.time),
  };
}

/** pino's `time`: ISO (the API's `isoTime`) or epoch ms (pino's default). */
function logTime(time: unknown): number {
  if (typeof time === 'number' && Number.isFinite(time)) return time;
  if (typeof time === 'string') {
    const parsed = Date.parse(time);
    if (Number.isFinite(parsed)) return parsed;
  }
  return Date.now();
}

/** Entries of a mailbox file (JSON lines); unreadable lines are skipped. */
export function parseMailbox(content: string): MailboxEntry[] {
  const entries: MailboxEntry[] = [];
  for (const line of content.split('\n')) {
    if (line.trim() === '') continue;
    try {
      entries.push(JSON.parse(line) as MailboxEntry);
    } catch {
      // A line cut by a crash of the stack: ignore it.
    }
  }
  return entries;
}

/** The newest sign-in code sent to `email` among `entries`. */
export function latestSignInCode(entries: readonly MailboxEntry[], email: string): string | null {
  const to = email.toLowerCase();
  for (let i = entries.length - 1; i >= 0; i -= 1) {
    const entry = entries[i];
    if (entry?.to === to && entry.kind === 'sign_in_code' && entry.code !== null) {
      return entry.code;
    }
  }
  return null;
}
