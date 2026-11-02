import { describe, expect, it } from 'vitest';
import { endpointErrorCodes } from '../endpoint.js';
import {
  acceptInvitation,
  createInvitation,
  getMe,
  invitationTokenSchema,
  listInvitations,
  previewInvitation,
  revokeInvitation,
  sendSignInCode,
  signInCodeSchema,
  signOut,
  verifySignInCode,
} from './index.js';

describe('auth endpoints', () => {
  it('are public to sign in and need a session to sign out', () => {
    expect(sendSignInCode.auth).toBe('public');
    expect(verifySignInCode.auth).toBe('public');
    expect(signOut.auth).toBe('session');
    expect(getMe.auth).toBe('session');
  });

  it('take a 6-digit code and default to the cookie transport', () => {
    expect(signInCodeSchema.safeParse('012345').success).toBe(true);
    expect(signInCodeSchema.safeParse('12345').success).toBe(false);
    expect(signInCodeSchema.safeParse('12345a').success).toBe(false);
    expect(
      verifySignInCode.body.parse({ email: 'ana@example.com', code: '012345' }).transport,
    ).toBe('cookie');
    expect(
      verifySignInCode.body.safeParse({ email: 'ana@example.com', code: '012345', transport: 'x' })
        .success,
    ).toBe(false);
  });
});

describe('invitation endpoints', () => {
  it('are club endpoints for admins and token endpoints for invitees', () => {
    for (const endpoint of [createInvitation, listInvitations, revokeInvitation]) {
      expect(endpoint.auth).toBe('club');
      expect(endpointErrorCodes(endpoint)).toEqual(
        expect.arrayContaining(['unauthenticated', 'forbidden']),
      );
    }
    expect(previewInvitation.auth).toBe('public');
    expect(acceptInvitation.auth).toBe('session');
  });

  it('keep the token out of the URL', () => {
    expect(previewInvitation.method).toBe('POST');
    expect(acceptInvitation.method).toBe('POST');
    expect(previewInvitation.path).not.toContain('{');
    expect(acceptInvitation.path).not.toContain('{');
  });

  it('accept only well-formed tokens', () => {
    expect(invitationTokenSchema.safeParse('A'.repeat(43)).success).toBe(true);
    expect(invitationTokenSchema.safeParse('A'.repeat(42)).success).toBe(false);
    expect(invitationTokenSchema.safeParse(`${'A'.repeat(42)}=`).success).toBe(false);
  });

  it('defaults the expiry and the categories and bounds them', () => {
    const body = createInvitation.body.parse({ email: 'coach@example.com', role: 'coach' });
    expect(body).toEqual({
      email: 'coach@example.com',
      role: 'coach',
      categoryIds: [],
      expiresInDays: 7,
    });
    expect(
      createInvitation.body.safeParse({ email: 'x@example.com', role: 'coach', expiresInDays: 31 })
        .success,
    ).toBe(false);
    expect(
      createInvitation.body.safeParse({ email: 'x@example.com', role: 'superadmin' }).success,
    ).toBe(false);
  });
});
