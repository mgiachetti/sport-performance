import { describe, expect, it } from 'vitest';
import {
  CLUB_MODULES,
  DEFAULT_CLUB_MODULES,
  applyClubModuleChanges,
  isClubModule,
  parseClubModule,
  resolveClubModules,
} from './club-modules.js';

describe('club modules', () => {
  it('has a default for every module, in well-formed codes', () => {
    expect(Object.keys(DEFAULT_CLUB_MODULES).sort()).toEqual([...CLUB_MODULES].sort());
    for (const module of CLUB_MODULES) expect(module).toMatch(/^[a-z]+(_[a-z]+)*$/);
  });

  it('starts the health-related and hardware modules off', () => {
    expect(DEFAULT_CLUB_MODULES.pain_report).toBe(false);
    expect(DEFAULT_CLUB_MODULES.menstrual_cycle).toBe(false);
    expect(DEFAULT_CLUB_MODULES.gps).toBe(false);
    expect(DEFAULT_CLUB_MODULES.wellness).toBe(true);
  });

  it('guards and parses module codes', () => {
    expect(isClubModule('gym')).toBe(true);
    expect(isClubModule('rankings')).toBe(false);
    expect(parseClubModule('gps')).toBe('gps');
    expect(() => parseClubModule('GPS')).toThrow(/club module/);
  });

  it('resolves stored choices over the defaults, ignoring junk', () => {
    expect(resolveClubModules(undefined)).toEqual(DEFAULT_CLUB_MODULES);
    expect(resolveClubModules([true])).toEqual(DEFAULT_CLUB_MODULES);
    expect(resolveClubModules({ gym: false, gps: true, rankings: true, wellness: 'no' })).toEqual({
      ...DEFAULT_CLUB_MODULES,
      gym: false,
      gps: true,
    });
  });

  it('stores every module explicitly after a change', () => {
    expect(applyClubModuleChanges({ gym: false }, { gps: true })).toEqual({
      ...DEFAULT_CLUB_MODULES,
      gym: false,
      gps: true,
    });
    expect(applyClubModuleChanges({ legacy: true }, {})).toEqual(DEFAULT_CLUB_MODULES);
  });
});
