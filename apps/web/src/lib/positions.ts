import type { Position } from '@sport-performance/contracts';
import type { Sport } from '@sport-performance/domain';
import { isMessageKey, type Translator } from '@sport-performance/i18n';
import { translate } from '../i18n/i18n';

type T = Translator['t'];

/** The catalog's text for a code, or the code itself when there is none. */
function codeLabel(t: T, key: string, code: string): string {
  return isMessageKey(key) ? translate(t, key) : code;
}

/**
 * Name of a position (B-801): the club's own label, else the catalog's name
 * of the default position of the sport ("Arquera"), else its code.
 */
export function positionName(t: T, position: Pick<Position, 'sport' | 'code' | 'label'>): string {
  if (position.label !== null) return position.label;
  return codeLabel(t, `configuration.position.${position.sport}.${position.code}`, position.code);
}

/** Name of a line of the sport ("Defensoras"), else its code. */
export function lineName(t: T, sport: Sport, line: string): string {
  return codeLabel(t, `configuration.line.${sport}.${line}`, line);
}
