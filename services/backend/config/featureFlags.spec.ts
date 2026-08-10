import { beforeAll, describe, expect, it, vi } from 'vitest';

import type * as FeatureFlagsModule from './featureFlags';
import { SignupMethod } from './signupMethods';

// tests/setup.ts mocks this module globally; importActual bypasses the mock so
// we exercise the real environment predicate.
let realModule: typeof FeatureFlagsModule;

beforeAll(async () => {
  realModule = await vi.importActual<typeof FeatureFlagsModule>('./featureFlags');
});

describe('getAllowedSignupMethodsForEnvironment', () => {
  it('returns invite-only for production with a hosted deployment', () => {
    expect(
      realModule.getAllowedSignupMethodsForEnvironment('production', 'convex-team-abc123')
    ).toEqual([SignupMethod.Invite]);
  });

  it('returns invite-only for production with no deployment marker', () => {
    expect(realModule.getAllowedSignupMethodsForEnvironment('production', undefined)).toEqual([
      SignupMethod.Invite,
    ]);
  });

  it('allows self signup for a development node environment', () => {
    expect(realModule.getAllowedSignupMethodsForEnvironment('development', undefined)).toEqual([
      SignupMethod.Self,
      SignupMethod.Invite,
    ]);
  });

  it('allows self signup for a local Convex deployment even under production', () => {
    expect(
      realModule.getAllowedSignupMethodsForEnvironment('production', 'local:chatroom')
    ).toEqual([SignupMethod.Self, SignupMethod.Invite]);
  });

  it('allows self signup for a local Convex deployment under development', () => {
    expect(
      realModule.getAllowedSignupMethodsForEnvironment('development', 'local:chatroom')
    ).toEqual([SignupMethod.Self, SignupMethod.Invite]);
  });

  it('fails closed to invite-only when environment values are missing', () => {
    expect(realModule.getAllowedSignupMethodsForEnvironment(undefined, undefined)).toEqual([
      SignupMethod.Invite,
    ]);
  });

  it('fails closed to invite-only for unknown node environments', () => {
    expect(
      realModule.getAllowedSignupMethodsForEnvironment('staging', 'convex-team-abc123')
    ).toEqual([SignupMethod.Invite]);
  });

  it('fails closed to invite-only for hosted deployments without a dev node env', () => {
    expect(
      realModule.getAllowedSignupMethodsForEnvironment(undefined, 'convex-team-abc123')
    ).toEqual([SignupMethod.Invite]);
  });
});

describe('featureFlags.allowedSignupMethods getter', () => {
  it('resolves the environment at runtime', () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('CONVEX_DEPLOYMENT', 'convex-team-abc123');
    expect(realModule.featureFlags.allowedSignupMethods).toEqual([SignupMethod.Invite]);

    vi.stubEnv('NODE_ENV', 'development');
    expect(realModule.featureFlags.allowedSignupMethods).toEqual([
      SignupMethod.Self,
      SignupMethod.Invite,
    ]);

    vi.stubEnv('CONVEX_DEPLOYMENT', 'local:chatroom');
    expect(realModule.featureFlags.allowedSignupMethods).toEqual([
      SignupMethod.Self,
      SignupMethod.Invite,
    ]);
  });
});
