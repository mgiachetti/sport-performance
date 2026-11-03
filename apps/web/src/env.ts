/**
 * Build-time environment of the web (Vite `import.meta.env`, `.env.example`).
 * Validated once at startup: a missing or malformed value stops the app with
 * a message that names the variable, instead of failing on the first request.
 */
export interface WebEnv {
  /** Origin of the API, without trailing slash. */
  readonly apiUrl: string;
}

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

export class InvalidWebEnvError extends Error {
  override readonly name = 'InvalidWebEnvError';
}

/**
 * Parses the raw environment. In production the API must be `https` (the
 * session cookie is `Secure`); plain `http` is only accepted against a
 * loopback host.
 */
export function parseWebEnv(raw: Readonly<Record<string, unknown>>, production: boolean): WebEnv {
  const value = raw.VITE_API_URL;
  if (typeof value !== 'string' || value.trim() === '') {
    throw new InvalidWebEnvError('VITE_API_URL is required (see apps/web/.env.example)');
  }
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    throw new InvalidWebEnvError(`VITE_API_URL is not a URL: ${value}`);
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new InvalidWebEnvError('VITE_API_URL must be http(s)');
  }
  if (url.protocol === 'http:' && production && !LOOPBACK_HOSTS.has(url.hostname)) {
    throw new InvalidWebEnvError('VITE_API_URL must be https in production');
  }
  if (url.search !== '' || url.hash !== '') {
    throw new InvalidWebEnvError('VITE_API_URL must not have a query or a fragment');
  }
  return { apiUrl: `${url.origin}${url.pathname}`.replace(/\/+$/, '') };
}
