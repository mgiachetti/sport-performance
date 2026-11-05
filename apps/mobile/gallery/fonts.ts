/// <reference types="vite/client" />
import { nativeFontFamilies } from '@sport-performance/ui-tokens';
import condensed400 from '@expo-google-fonts/barlow-condensed/400Regular/BarlowCondensed_400Regular.ttf?url';
import condensed500 from '@expo-google-fonts/barlow-condensed/500Medium/BarlowCondensed_500Medium.ttf?url';
import condensed600 from '@expo-google-fonts/barlow-condensed/600SemiBold/BarlowCondensed_600SemiBold.ttf?url';
import condensed700 from '@expo-google-fonts/barlow-condensed/700Bold/BarlowCondensed_700Bold.ttf?url';
import condensed800 from '@expo-google-fonts/barlow-condensed/800ExtraBold/BarlowCondensed_800ExtraBold.ttf?url';
import text400 from '@expo-google-fonts/barlow/400Regular/Barlow_400Regular.ttf?url';
import text500 from '@expo-google-fonts/barlow/500Medium/Barlow_500Medium.ttf?url';
import text600 from '@expo-google-fonts/barlow/600SemiBold/Barlow_600SemiBold.ttf?url';
import text700 from '@expo-google-fonts/barlow/700Bold/Barlow_700Bold.ttf?url';
import text800 from '@expo-google-fonts/barlow/800ExtraBold/Barlow_800ExtraBold.ttf?url';

/**
 * The same families the app loads with `useFonts` (`src/ui/fonts.ts`), one
 * `@font-face` per weight under the native family name, so the text styles of
 * `ui-tokens` render as on the phone.
 */
const FILES: Readonly<Record<string, string>> = {
  [nativeFontFamilies.condensed[400]]: condensed400,
  [nativeFontFamilies.condensed[500]]: condensed500,
  [nativeFontFamilies.condensed[600]]: condensed600,
  [nativeFontFamilies.condensed[700]]: condensed700,
  [nativeFontFamilies.condensed[800]]: condensed800,
  [nativeFontFamilies.text[400]]: text400,
  [nativeFontFamilies.text[500]]: text500,
  [nativeFontFamilies.text[600]]: text600,
  [nativeFontFamilies.text[700]]: text700,
  [nativeFontFamilies.text[800]]: text800,
};

export async function loadFonts(): Promise<void> {
  const faces = Object.entries(FILES).map(([family, url]) => new FontFace(family, `url(${url})`));
  await Promise.all(faces.map((face) => face.load()));
  for (const face of faces) document.fonts.add(face);
}
