import { Barlow_400Regular } from '@expo-google-fonts/barlow/400Regular';
import { Barlow_500Medium } from '@expo-google-fonts/barlow/500Medium';
import { Barlow_600SemiBold } from '@expo-google-fonts/barlow/600SemiBold';
import { Barlow_700Bold } from '@expo-google-fonts/barlow/700Bold';
import { Barlow_800ExtraBold } from '@expo-google-fonts/barlow/800ExtraBold';
import { BarlowCondensed_400Regular } from '@expo-google-fonts/barlow-condensed/400Regular';
import { BarlowCondensed_500Medium } from '@expo-google-fonts/barlow-condensed/500Medium';
import { BarlowCondensed_600SemiBold } from '@expo-google-fonts/barlow-condensed/600SemiBold';
import { BarlowCondensed_700Bold } from '@expo-google-fonts/barlow-condensed/700Bold';
import { BarlowCondensed_800ExtraBold } from '@expo-google-fonts/barlow-condensed/800ExtraBold';
import { nativeFontFamilies } from '@sport-performance/ui-tokens';

/**
 * Barlow and Barlow Condensed, one asset per weight, keyed by the family
 * names `ui-tokens` puts in every text style (`nativeFontFamilies`). Loaded
 * at runtime with `useFonts`, so the names are the same on iOS and Android.
 */
export const APP_FONTS = {
  [nativeFontFamilies.text[400]]: Barlow_400Regular,
  [nativeFontFamilies.text[500]]: Barlow_500Medium,
  [nativeFontFamilies.text[600]]: Barlow_600SemiBold,
  [nativeFontFamilies.text[700]]: Barlow_700Bold,
  [nativeFontFamilies.text[800]]: Barlow_800ExtraBold,
  [nativeFontFamilies.condensed[400]]: BarlowCondensed_400Regular,
  [nativeFontFamilies.condensed[500]]: BarlowCondensed_500Medium,
  [nativeFontFamilies.condensed[600]]: BarlowCondensed_600SemiBold,
  [nativeFontFamilies.condensed[700]]: BarlowCondensed_700Bold,
  [nativeFontFamilies.condensed[800]]: BarlowCondensed_800ExtraBold,
} as const;
