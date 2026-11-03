import { describe, expect, it } from 'vitest';
import {
  clubDataExportSchema,
  createClubDataExport,
  getClubDataExportDownload,
  listClubDataExports,
} from './index.js';

describe('club data exports', () => {
  it('are club endpoints under /v1/data-exports', () => {
    expect(createClubDataExport).toMatchObject({
      method: 'POST',
      path: '/v1/data-exports',
      auth: 'club',
    });
    expect(createClubDataExport.response.status).toBe(202);
    expect(listClubDataExports.method).toBe('GET');
    expect(getClubDataExportDownload.path).toBe('/v1/data-exports/{exportId}/download');
  });

  it('takes optional datasets and a range of club days', () => {
    const body = createClubDataExport.body;
    expect(body.parse({})).toEqual({});
    expect(
      body.parse({ datasets: ['players', 'wellness'], from: '2026-03-01', to: '2026-03-01' }),
    ).toEqual({ datasets: ['players', 'wellness'], from: '2026-03-01', to: '2026-03-01' });
    for (const invalid of [
      { datasets: [] },
      { datasets: ['medical'] },
      { from: '2026-03-02', to: '2026-03-01' },
      { from: '01/03/2026' },
      { playerIds: [] },
    ]) {
      expect(body.safeParse(invalid).success, JSON.stringify(invalid)).toBe(false);
    }
  });

  it('describes an export without the players it includes', () => {
    const shape = Object.keys(clubDataExportSchema.shape);
    expect(shape).toContain('playerCount');
    expect(shape).not.toContain('playerIds');
    expect(shape).not.toContain('availability');
  });
});
