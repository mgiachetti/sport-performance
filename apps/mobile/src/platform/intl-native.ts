import { setDefaultTimeZone } from './intl.ts';
import { getCalendars } from 'expo-localization';

// The phone's zone for the polyfilled `DateTimeFormat` (see `intl.ts`).
setDefaultTimeZone(getCalendars().at(0)?.timeZone);
