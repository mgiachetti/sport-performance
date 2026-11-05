import { createTranslator } from '@sport-performance/i18n';
import type { ThemeVariant } from '@sport-performance/ui-tokens';
import { createRoot } from 'react-dom/client';
import { nativeThemeFor } from '../src/branding/club-branding.ts';
import { TranslatorProvider } from '../src/ui/i18n.tsx';
import { ThemeProvider } from '../src/ui/theme.tsx';
import { loadFonts } from './fonts.ts';
import { SCENES } from './scene-list.ts';
import { SCENE_RENDERERS } from './scenes.tsx';

/**
 * `?scene=<name>&variant=dark|light-hc` renders one scene full screen; without
 * `scene`, an index of links. The capture waits for `data-gallery-ready`.
 */
const params = new URLSearchParams(location.search);
const variant: ThemeVariant = params.get('variant') === 'light-hc' ? 'light-hc' : 'dark';
const name = params.get('scene');
const translator = createTranslator();
// `full=1`: the page grows with the content (the scroll view no longer clips it), for a full-page capture.
if (params.get('full') === '1') document.documentElement.dataset.full = 'true';
const container = document.getElementById('root');
if (container === null) throw new Error('The gallery needs #root');
const root = createRoot(container);

function Index() {
  return (
    <ul style={{ fontFamily: 'system-ui', lineHeight: 1.8 }}>
      {SCENES.map((scene) => (
        <li key={scene.name}>
          <a href={`?scene=${scene.name}`}>{scene.name}</a> ·{' '}
          <a href={`?scene=${scene.name}&variant=light-hc`}>light-hc</a>
        </li>
      ))}
    </ul>
  );
}

await loadFonts();
const scene = name === null ? null : SCENE_RENDERERS[name];
if (scene === undefined) throw new Error(`Unknown scene: ${String(name)}`);
const theme = nativeThemeFor(scene?.clubTheme ?? null, variant);
document.body.style.backgroundColor = theme.colors.background;
root.render(
  scene === null ? (
    <Index />
  ) : (
    <TranslatorProvider translator={translator}>
      <ThemeProvider
        value={{
          theme,
          variant,
          setVariant: () => undefined,
          club:
            scene.clubTheme === null
              ? null
              : {
                  name: scene.clubTheme.name,
                  shortName: scene.clubTheme.shortName,
                  logoUrl: scene.clubTheme.logoUrl,
                },
        }}
      >
        {scene.render()}
      </ThemeProvider>
    </TranslatorProvider>
  ),
);
document.body.dataset.galleryReady = 'true';
