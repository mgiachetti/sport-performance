// On EAS Build only: build the workspace packages the app imports (their `dist`) right
// after install, because EAS reads `app.config.ts` (which imports @sport-performance/ui-tokens)
// before any build hook runs. Locally and in CI this is a no-op: turbo builds them on demand.
import { execSync } from 'node:child_process';

if (process.env.EAS_BUILD === 'true') {
  execSync("pnpm --dir ../.. exec turbo run build --filter='@sport-performance/mobile^...'", {
    stdio: 'inherit',
  });
}
