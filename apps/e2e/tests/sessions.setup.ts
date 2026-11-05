import { expect, request, test as setup } from '@playwright/test';
import {
  DEMO_ACCOUNTS,
  mailboxMark,
  waitForSignInCode,
  type DemoAccount,
} from '../src/harness/index.ts';
import { accountEmail, endpoints, sessionFile } from './support.ts';

/**
 * One web session per demo account, opened once through the API the way the
 * login page does it (`email-otp`, then `verify` with the cookie transport)
 * and saved as storage state. The scenarios reuse them: the sign-in limits
 * per email and IP (ADR 0028) stay far away. The login page itself is
 * covered by `auth.spec.ts`.
 */
for (const account of Object.keys(DEMO_ACCOUNTS) as DemoAccount[]) {
  setup(`session of ${account}`, async () => {
    const email = accountEmail(account);
    // The web's origin, as the browser sends it: the API's origin guard checks it (ADR 0028).
    const api = await request.newContext({ extraHTTPHeaders: { origin: endpoints.webUrl } });
    try {
      const mark = await mailboxMark(endpoints.runDir);
      const sent = await api.post(`${endpoints.apiUrl}/v1/auth/email-otp`, { data: { email } });
      expect(sent.status(), await sent.text()).toBe(202);
      const code = await waitForSignInCode(endpoints.runDir, email, mark);
      const verified = await api.post(`${endpoints.apiUrl}/v1/auth/email-otp/verify`, {
        data: { email, code, transport: 'cookie' },
      });
      expect(verified.status(), await verified.text()).toBe(200);
      const me = await api.get(`${endpoints.apiUrl}/v1/me`);
      expect(me.status()).toBe(200);
      await api.storageState({ path: sessionFile(account) });
    } finally {
      await api.dispose();
    }
  });
}
