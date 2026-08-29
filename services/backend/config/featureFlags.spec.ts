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
      realModule.getAllowedSignupMethodsForEnvironment(
        'production',
        'convex-team-abc123',
        undefined
      )
    ).toEqual([SignupMethod.Invite]);
  });

  it('returns invite-only for production with no deployment marker', () => {
    expect(
      realModule.getAllowedSignupMethodsForEnvironment('production', undefined, undefined)
    ).toEqual([SignupMethod.Invite]);
  });

  it('allows self signup for a development node environment', () => {
    expect(
      realModule.getAllowedSignupMethodsForEnvironment('development', undefined, undefined)
    ).toEqual([SignupMethod.Self, SignupMethod.Invite]);
  });

  it('allows self signup for a local Convex deployment even under production', () => {
    expect(
      realModule.getAllowedSignupMethodsForEnvironment('production', 'local:chatroom', undefined)
    ).toEqual([SignupMethod.Self, SignupMethod.Invite]);
  });

  it('allows self signup for a local Convex deployment under development', () => {
    expect(
      realModule.getAllowedSignupMethodsForEnvironment('development', 'local:chatroom', undefined)
    ).toEqual([SignupMethod.Self, SignupMethod.Invite]);
  });

  it('fails closed to invite-only when environment values are missing', () => {
    expect(
      realModule.getAllowedSignupMethodsForEnvironment(undefined, undefined, undefined)
    ).toEqual([SignupMethod.Invite]);
  });

  it('fails closed to invite-only for unknown node environments', () => {
    expect(
      realModule.getAllowedSignupMethodsForEnvironment('staging', 'convex-team-abc123', undefined)
    ).toEqual([SignupMethod.Invite]);
  });

  it('fails closed to invite-only for hosted deployments without a dev node env', () => {
    expect(
      realModule.getAllowedSignupMethodsForEnvironment(undefined, 'convex-team-abc123', undefined)
    ).toEqual([SignupMethod.Invite]);
  });

  it('allows self signup when E2E seeding is enabled (CI self-hosted deploy)', () => {
    expect(
      realModule.getAllowedSignupMethodsForEnvironment('production', 'convex-team-abc123', 'true')
    ).toEqual([SignupMethod.Self, SignupMethod.Invite]);
  });

  it('does not allow self signup when E2E seeding is not true', () => {
    expect(
      realModule.getAllowedSignupMethodsForEnvironment('production', 'convex-team-abc123', 'false')
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

    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('CONVEX_DEPLOYMENT', 'convex-team-abc123');
    vi.stubEnv('E2E_SEEDING_ENABLED', 'true');
    expect(realModule.featureFlags.allowedSignupMethods).toEqual([
      SignupMethod.Self,
      SignupMethod.Invite,
    ]);
  });
});
