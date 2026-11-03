import {
  CONSENT_STATES,
  CONSENT_TYPES,
  GUARDIAN_RELATIONSHIPS,
  HEIGHT_SOURCES,
  PARENTS,
} from '@sport-performance/domain';
import { describe, expect, it } from 'vitest';
import { esAR, isMessageKey } from './index.js';
import { webGuardianMessagesEsAR } from './web-guardian.js';

describe('family area messages', () => {
  it('are part of the source catalog, all under guardian.*', () => {
    for (const [key, message] of Object.entries(webGuardianMessagesEsAR)) {
      expect(key.startsWith('guardian.'), key).toBe(true);
      expect(esAR[key as keyof typeof esAR], key).toBe(message);
    }
  });

  it('name every relationship, consent type and state, height source and parent', () => {
    for (const value of GUARDIAN_RELATIONSHIPS) {
      expect(isMessageKey(`guardian.relationship.${value}`), value).toBe(true);
    }
    for (const value of CONSENT_TYPES) {
      expect(isMessageKey(`guardian.consents.type.${value}`), value).toBe(true);
      expect(isMessageKey(`guardian.consents.typeHelp.${value}`), value).toBe(true);
    }
    for (const value of CONSENT_STATES) {
      expect(isMessageKey(`guardian.consents.state.${value}`), value).toBe(true);
    }
    for (const value of HEIGHT_SOURCES) {
      expect(isMessageKey(`guardian.heights.source.${value}`), value).toBe(true);
    }
    for (const value of PARENTS) {
      expect(isMessageKey(`guardian.heights.parent.${value}`), value).toBe(true);
    }
  });
});
