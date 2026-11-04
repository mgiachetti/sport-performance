import { alertMessage, formatAlertValue, type Translator } from '@sport-performance/i18n';

/**
 * Text of an alert from what the API sends (`messageKey` + raw `values`, ADR 0053). The
 * formatting lives in `packages/i18n` (`alertMessage`), shared with the app (B-510).
 */
export { formatAlertValue };

/** The alert's message, or `null` when this build does not know the key yet. */
export function alertText(
  t: Translator['t'],
  alert: { readonly messageKey: string; readonly values: Readonly<Record<string, number>> },
): string | null {
  return alertMessage(t, alert.messageKey, alert.values);
}
