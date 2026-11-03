import type { TestDefinitionDto } from '@sport-performance/contracts';
import { addDays, isUnitCode } from '@sport-performance/domain';
import {
  formatLocalDate,
  isMessageKey,
  unitLabelEsAr,
  type Translator,
} from '@sport-performance/i18n';
import { translate } from '../../i18n/i18n';

/** Name of a test: the catalog label of a canonical code, the code itself for a club test. */
export function testLabel(t: Translator['t'], code: string): string {
  const key = `test.${code}`;
  return isMessageKey(key) ? translate(t, key) : code;
}

/** Rest between attempts: whole minutes when it is, seconds otherwise. */
export function restLabel(t: Translator['t'], seconds: number): string {
  const duration =
    seconds >= 60 && seconds % 60 === 0
      ? t('protocol.restMinutes', { minutes: seconds / 60 })
      : t('protocol.restSeconds', { seconds });
  return t('protocol.rest', { duration });
}

/** "Vigente desde el dd/mm/aaaa", or the days of a closed version (`validTo` is exclusive). */
export function validityLabel(
  t: Translator['t'],
  definition: Pick<TestDefinitionDto, 'validFrom' | 'validTo'>,
): string {
  return definition.validTo === null
    ? t('protocol.validFrom', { date: formatLocalDate(definition.validFrom) })
    : t('protocol.validRange', {
        from: formatLocalDate(definition.validFrom),
        to: formatLocalDate(addDays(definition.validTo, -1)),
      });
}

/** es-AR label of a metric's unit (`m/s`, `años`); empty for counts and scores. */
export function unitLabel(unit: string): string {
  return isUnitCode(unit) ? unitLabelEsAr(unit) : unit;
}
