/**
 * Measuring devices of the club (B-606, ADR 0077) against Postgres 16,
 * through the real connection roles (ADR 0026): the matrix in the handlers
 * (`device.read` for the staff, `device.manage` for `sc` and the
 * administration), the RLS of `device` behind it, idempotent registration,
 * the serial number unique per kind, versions and retiring instead of
 * deleting.
 */
import { randomUUID } from 'node:crypto';
import type { ClubId } from '@sport-performance/domain';
import { afterAll, beforeAll, expect, it } from 'vitest';
import {
  createMembership,
  createTestDatabase,
  signIn,
  startIdentityApp,
  type IdentityTestApp,
  type SignedIn,
  type TestDatabase,
} from '../testing/identity.js';
import { describeWithPostgres } from '../testing/support.js';

interface DeviceBody {
  id: string;
  kind: string;
  label: string;
  model: string | null;
  serialNumber: string | null;
  firmwareVersion: string | null;
  retiredAt: string | null;
  version: string;
}

interface Page<T> {
  items: T[];
  nextCursor: string | null;
}

const SUPPORT_REASON = encodeURIComponent('Alta de equipos pedida por el club');

describeWithPostgres('devices (Postgres)', (serverUrl) => {
  let database: TestDatabase;
  let t: IdentityTestApp;
  let superadmin: SignedIn;
  let sc: SignedIn;
  let coach: SignedIn;
  let medical: SignedIn;
  let player: SignedIn;
  let parent: SignedIn;
  let admin: SignedIn;
  let adminB: SignedIn;
  let clubA: ClubId;
  let clubB: ClubId;

  const request = (
    caller: SignedIn,
    method: 'GET' | 'POST' | 'PATCH',
    url: string,
    payload?: Record<string, unknown>,
  ) =>
    t.app.inject({
      method,
      url,
      headers: caller.headers,
      ...(payload !== undefined && { payload }),
    });

  async function register(caller: SignedIn, payload: Record<string, unknown>) {
    const response = await request(caller, 'POST', '/v1/devices', payload);
    expect(response.statusCode, response.body).toBe(201);
    return response.json<DeviceBody>();
  }

  async function createClubAs(slug: string): Promise<ClubId> {
    const response = await t.app.inject({
      method: 'POST',
      url: '/v1/clubs',
      headers: { ...superadmin.headers, 'x-support-reason': SUPPORT_REASON },
      payload: {
        slug,
        name: `Club ${slug}`,
        shortName: slug.toUpperCase(),
        branches: [{ sport: 'rugby', sex: 'male' }],
      },
    });
    expect(response.statusCode, response.body).toBe(201);
    return response.json<{ club: { id: ClubId } }>().club.id;
  }

  beforeAll(async () => {
    database = await createTestDatabase(serverUrl);
    t = await startIdentityApp(database, {
      routeClassLimits: { auth: { perIp: { name: 'api_auth_ip', max: 1000, windowS: 60 } } },
    });
    superadmin = await signIn(t, 'soporte@plataforma.example.com');
    await database.admin.query('update "user" set is_superadmin = true where id = $1', [
      superadmin.userId,
    ]);
    clubA = await createClubAs('devices-a');
    clubB = await createClubAs('devices-b');
    sc = await signIn(t, 'sc@devices-a.example.com');
    coach = await signIn(t, 'coach@devices-a.example.com');
    medical = await signIn(t, 'medical@devices-a.example.com');
    player = await signIn(t, 'player@devices-a.example.com');
    parent = await signIn(t, 'parent@devices-a.example.com');
    admin = await signIn(t, 'admin@devices-a.example.com');
    adminB = await signIn(t, 'admin@devices-b.example.com');
    await createMembership(database.admin, sc.userId, clubA, 'sc');
    await createMembership(database.admin, coach.userId, clubA, 'coach');
    await createMembership(database.admin, medical.userId, clubA, 'medical');
    await createMembership(database.admin, player.userId, clubA, 'player');
    await createMembership(database.admin, parent.userId, clubA, 'parent');
    await createMembership(database.admin, admin.userId, clubA, 'admin');
    await createMembership(database.admin, adminB.userId, clubB, 'admin');
  }, 90_000);

  afterAll(async () => {
    await t.close();
    await database.drop();
  });

  it('registers a phone once per client UUID and recognizes it by its serial number', async () => {
    const clientUuid = randomUUID();
    const payload = {
      clientUuid,
      kind: 'phone',
      label: 'Celular de la preparación física',
      model: 'Pixel 9',
      serialNumber: 'install-0001',
      firmwareVersion: 'Android 16',
    };
    const first = await register(sc, payload);
    expect(first).toMatchObject({
      kind: 'phone',
      label: 'Celular de la preparación física',
      model: 'Pixel 9',
      serialNumber: 'install-0001',
      retiredAt: null,
    });
    // The retry of the same registration (offline queue, lost response) answers the same row.
    const again = await request(sc, 'POST', '/v1/devices', payload);
    expect(again.statusCode, again.body).toBe(201);
    expect(again.headers['x-idempotent-replay']).toBe('true');
    expect(again.json<DeviceBody>().id).toBe(first.id);

    // Another registration of the same phone is a conflict that says where to look.
    const duplicate = await request(sc, 'POST', '/v1/devices', {
      ...payload,
      clientUuid: randomUUID(),
      label: 'Otro nombre',
    });
    expect(duplicate.statusCode, duplicate.body).toBe(409);
    expect(
      duplicate.json<{ error: { details: { path: string[] }[] } }>().error.details[0]?.path,
    ).toEqual(['body', 'serialNumber']);

    const found = await request(coach, 'GET', '/v1/devices?serialNumber=install-0001');
    expect(found.statusCode, found.body).toBe(200);
    expect(found.json<Page<DeviceBody>>().items.map((d) => d.id)).toEqual([first.id]);
    // The same serial number on another kind is another device.
    await register(admin, { kind: 'tablet', label: 'Tablet', serialNumber: 'install-0001' });
  });

  it('lets the staff read, and only sc and the administration manage', async () => {
    const device = await register(admin, { kind: 'tablet', label: 'Tablet del club 1' });
    for (const reader of [coach, medical, sc, admin]) {
      const response = await request(reader, 'GET', `/v1/devices/${device.id}`);
      expect(response.statusCode, response.body).toBe(200);
    }
    for (const outsider of [player, parent]) {
      expect((await request(outsider, 'GET', '/v1/devices')).statusCode).toBe(403);
      expect(
        (await request(outsider, 'POST', '/v1/devices', { kind: 'phone', label: 'X' })).statusCode,
      ).toBe(403);
    }
    for (const notManager of [coach, medical]) {
      expect(
        (await request(notManager, 'POST', '/v1/devices', { kind: 'phone', label: 'X' }))
          .statusCode,
      ).toBe(403);
      expect(
        (await request(notManager, 'POST', `/v1/devices/${device.id}/retire`)).statusCode,
      ).toBe(403);
    }
  });

  it('never shows nor touches the devices of another club', async () => {
    const mine = await register(sc, { kind: 'phone', label: 'Solo del club A' });
    expect((await request(adminB, 'GET', `/v1/devices/${mine.id}`)).statusCode).toBe(404);
    expect((await request(adminB, 'POST', `/v1/devices/${mine.id}/retire`)).statusCode).toBe(404);
    const list = await request(adminB, 'GET', '/v1/devices?status=all');
    expect(list.json<Page<DeviceBody>>().items).toEqual([]);
  });

  it('edits at a version, retires instead of deleting and restores', async () => {
    const device = await register(sc, { kind: 'phone', label: 'Celular 2' });
    const edited = await request(sc, 'PATCH', `/v1/devices/${device.id}`, {
      version: device.version,
      label: 'Celular 2 (vestuario)',
      model: null,
    });
    expect(edited.statusCode, edited.body).toBe(200);
    expect(edited.json<DeviceBody>().label).toBe('Celular 2 (vestuario)');
    const stale = await request(sc, 'PATCH', `/v1/devices/${device.id}`, {
      version: device.version,
      label: 'Viejo',
    });
    expect(stale.statusCode).toBe(409);

    const retired = await request(sc, 'POST', `/v1/devices/${device.id}/retire`);
    expect(retired.statusCode, retired.body).toBe(200);
    const retiredAt = retired.json<DeviceBody>().retiredAt;
    expect(retiredAt).not.toBeNull();
    // Idempotent: retiring again keeps the first date.
    expect(
      (await request(sc, 'POST', `/v1/devices/${device.id}/retire`)).json<DeviceBody>().retiredAt,
    ).toBe(retiredAt);
    const active = await request(sc, 'GET', '/v1/devices?limit=100');
    expect(active.json<Page<DeviceBody>>().items.some((d) => d.id === device.id)).toBe(false);
    const archived = await request(sc, 'GET', '/v1/devices?status=archived');
    expect(archived.json<Page<DeviceBody>>().items.map((d) => d.id)).toContain(device.id);
    // A retired device is restored before it is edited.
    const current = retired.json<DeviceBody>();
    expect(
      (
        await request(sc, 'PATCH', `/v1/devices/${device.id}`, {
          version: current.version,
          label: 'No',
        })
      ).statusCode,
    ).toBe(409);
    const restored = await request(sc, 'POST', `/v1/devices/${device.id}/restore`);
    expect(restored.json<DeviceBody>().retiredAt).toBeNull();
  });

  it('pages by label and validates the input strictly', async () => {
    for (const label of ['Z equipo', 'A equipo', 'M equipo']) {
      await register(admin, { kind: 'photocell', label });
    }
    const first = await request(admin, 'GET', '/v1/devices?kind=photocell&limit=2');
    const page = first.json<Page<DeviceBody>>();
    expect(page.items.map((d) => d.label)).toEqual(['A equipo', 'M equipo']);
    expect(page.nextCursor).not.toBeNull();
    const second = await request(
      admin,
      'GET',
      `/v1/devices?kind=photocell&limit=2&cursor=${encodeURIComponent(page.nextCursor ?? '')}`,
    );
    expect(second.json<Page<DeviceBody>>().items.map((d) => d.label)).toEqual(['Z equipo']);

    for (const payload of [
      { kind: 'phone', label: ' con espacios ' },
      { kind: 'toaster', label: 'Tostadora' },
      { kind: 'phone', label: 'Celular', extra: true },
    ]) {
      expect((await request(admin, 'POST', '/v1/devices', payload)).statusCode).toBe(400);
    }
  });
});
