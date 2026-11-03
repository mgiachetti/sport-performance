import type { GymProgram } from '@sport-performance/contracts';
import { parseLocalDate } from '@sport-performance/domain';
import { uuid } from './fake-sync-server.ts';

const AT = '2026-11-01T12:00:00.000Z';

/** A program of a category (B-607): one day with a trap-bar deadlift for M15/M16. */
export function programDto(overrides: Partial<GymProgram> = {}): GymProgram {
  return {
    id: uuid() as GymProgram['id'],
    name: 'Fuerza M15',
    categoryId: 'c2222222-2222-4222-8222-222222222222' as GymProgram['categoryId'],
    playerId: null,
    stage: null,
    plan: {
      days: [
        {
          key: 'a',
          name: 'Inferior',
          exercises: [
            {
              exerciseCode: 'trap_bar_deadlift',
              name: null,
              loadKind: 'external',
              measure: 'reps',
              sets: 3,
              repsMin: 3,
              repsMax: 5,
              durationS: null,
              targetRir: 2,
              loadKg: 62.5,
              restS: 120,
              notes: null,
            },
          ],
        },
      ],
    },
    notes: null,
    validFrom: parseLocalDate('2026-10-01'),
    validTo: null,
    archivedAt: null,
    createdAt: AT,
    updatedAt: AT,
    version: '1',
    ...overrides,
  };
}
