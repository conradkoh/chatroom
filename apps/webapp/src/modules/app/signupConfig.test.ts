import { describe, expect, it } from 'vitest';

import { deriveSignupConfig } from './signupConfig';

describe('deriveSignupConfig', () => {
  it('self only: self allowed, invite not, label Open (self)', () => {
    expect(deriveSignupConfig(['self'])).toEqual({
      methods: ['self'],
      signupAllowed: true,
      selfSignupAllowed: true,
      inviteSignupAllowed: false,
      inviteOnlyMode: false,
      label: 'Open (self)',
    });
  });

  it('invite only: inviteOnlyMode true, label Invite only', () => {
    expect(deriveSignupConfig(['invite'])).toEqual({
      methods: ['invite'],
      signupAllowed: true,
      selfSignupAllowed: false,
      inviteSignupAllowed: true,
      inviteOnlyMode: true,
      label: 'Invite only',
    });
  });

  it('self and invite: both allowed, label Self + Invite', () => {
    expect(deriveSignupConfig(['self', 'invite'])).toEqual({
      methods: ['self', 'invite'],
      signupAllowed: true,
      selfSignupAllowed: true,
      inviteSignupAllowed: true,
      inviteOnlyMode: false,
      label: 'Self + Invite',
    });
  });

  it('empty array: signups closed, label Disabled', () => {
    expect(deriveSignupConfig([])).toEqual({
      methods: [],
      signupAllowed: false,
      selfSignupAllowed: false,
      inviteSignupAllowed: false,
      inviteOnlyMode: false,
      label: 'Disabled',
    });
  });

  it('undefined (older backend) fails closed to invite-only', () => {
    expect(deriveSignupConfig(undefined)).toEqual({
      methods: ['invite'],
      signupAllowed: true,
      selfSignupAllowed: false,
      inviteSignupAllowed: true,
      inviteOnlyMode: true,
      label: 'Invite only',
    });
  });
});
