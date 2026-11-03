import { redirectSystemPath as appLinkPath } from '../src/linking/app-links.ts';
import { runtimeConfig } from '../src/platform/native.ts';

/**
 * Every URL the system opens the app with (deep links, Universal Links, App
 * Links) goes through here before the router: our links go to their screen,
 * anything else of ours goes home, other URLs (the development client's) pass.
 */
export function redirectSystemPath({ path }: { path: string; initial: boolean }): string {
  try {
    const { scheme, webAppUrl } = runtimeConfig();
    return appLinkPath(path, { scheme, webAppUrl });
  } catch {
    // Never crash on a link (expo-router's advice): open the app at its start.
    return '/';
  }
}
