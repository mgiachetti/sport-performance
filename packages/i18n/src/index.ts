/** Workspace package identifier (the app skeletons use it to verify cross-package resolution). */
export const packageName = '@sport-performance/i18n' as const;

export {
  DEFAULT_LOCALE,
  type Locale,
  SUPPORTED_LOCALES,
  isSupportedLocale,
  parseAcceptLanguage,
  resolveLocale,
} from './locale.js';

export {
  type MessageArgs,
  type MessageCatalog,
  type MessageKey,
  type MessageValue,
  type MessageValues,
  type SourceMessages,
  catalogs,
  esAR,
  isMessageKey,
  messageKeys,
} from './messages/index.js';
export {
  type ArgumentKind,
  type CatalogIssue,
  extractArguments,
  validateCatalog,
} from './messages/validate.js';
export {
  MessageFormatError,
  type Translator,
  type TranslatorOptions,
  createTranslator,
} from './translator.js';

export {
  NBSP,
  type NumberFormatOptions,
  PLACEHOLDER,
  type ParseNumberOptions,
  formatNumber,
  getSeparators,
  parseNumber,
} from './format/number.js';
export {
  UNIT_DEFAULT_DECIMALS,
  UNIT_MESSAGES_ES_AR,
  type UnitMessageKey,
  formatUnit,
  unitLabelEsAr,
  unitMessageKey,
} from './format/unit.js';
export { formatDuration } from './format/duration.js';
export { retryWaitValues } from './format/wait.js';
export {
  type DateFormatOptions,
  type LongDateOptions,
  formatDate,
  formatDateLong,
  formatDateTime,
  formatLocalDate,
  formatLocalDateLong,
  formatLocalMonth,
  formatTime,
} from './format/date.js';
