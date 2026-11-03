// Self-hosted fonts (no third-party CDN): Barlow for text, Barlow Condensed for titles and figures.
import '@fontsource/barlow/latin-400.css';
import '@fontsource/barlow/latin-500.css';
import '@fontsource/barlow/latin-600.css';
import '@fontsource/barlow/latin-700.css';
import '@fontsource/barlow-condensed/latin-600.css';
import '@fontsource/barlow-condensed/latin-700.css';
import '@sport-performance/charts/web/charts.css';
import './styles/app.css';

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App, defaultTranslator } from './app/App';
import { createWebApp } from './app/create-app';
import { parseWebEnv, type WebEnv } from './env';
import { browserStorage } from './lib/store';

const root = document.getElementById('root');
if (root === null) throw new Error('index.html has no #root');

let env: WebEnv;
try {
  env = parseWebEnv(import.meta.env, import.meta.env.PROD);
} catch (error) {
  // A broken build must say so instead of showing a blank page.
  root.textContent = defaultTranslator(navigator.languages).t('error.generic');
  throw error;
}

const app = createWebApp({
  apiUrl: env.apiUrl,
  storage: { local: browserStorage('local'), session: browserStorage('session') },
  browserOnline: navigator.onLine,
  systemPrefersMoreContrast:
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-contrast: more)').matches,
});

createRoot(root).render(
  <StrictMode>
    <App app={app} translator={defaultTranslator(navigator.languages)} />
  </StrictMode>,
);
