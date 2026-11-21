import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import type * as FeatureFlagsModule from './featureFlags';
import { SignupMethod } from './signupMethods';

// tests/setup.ts mocks this module globally; vi.importActual bypasses the mock so we
// exercise the real predicate.
//
// Evidence note: the runtime env contract documented in featureFlags.ts (CONVEX_CLOUD_URL is
// provided by the platform, CONVEX_DEPLOYMENT is absent, NODE_ENV is 'production') is evidenced
// by triage's real-binary probe, not provable by unit tests. These tests pin the decision for
// those inputs.
let realModule: typeof FeatureFlagsModule;

const SELF_AND_INVITE = [SignupMethod.Self, SignupMethod.Invite];
const INVITE_ONLY = [SignupMethod.Invite];

beforeAll(async () => {
  realModule = await vi.importActual<typeof FeatureFlagsModule>('./featureFlags');
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('getAllowedSignupMethodsForEnvironment', () => {
  it('allows self signup on a fresh local instance advertising a loopback http origin', () => {
    expect(
      realModule.getAllowedSignupMethodsForEnvironment({
        convexCloudUrl: 'http://127.0.0.1:3210',
        e2eSeedingEnabled: undefined,
      })
    ).toEqual(SELF_AND_INVITE);
  });

  it.each([
    ['127.0.0.1 on another port', 'http://127.0.0.1:3220'],
    ['another 127.x.y.z address', 'http://127.0.0.2:3210'],
    ['localhost', 'http://localhost:3210'],
    ['IPv6 loopback', 'http://[::1]:3210'],
  ])('allows self signup for loopback http origin: %s', (_label, convexCloudUrl) => {
    expect(
      realModule.getAllowedSignupMethodsForEnvironment({
        convexCloudUrl,
        e2eSeedingEnabled: undefined,
      })
    ).toEqual(SELF_AND_INVITE);
  });

  it('decides on the URL host only: userinfo before a loopback host still allows self signup', () => {
    // WHATWG parses `evil.com@` as userinfo; the host is 127.0.0.1.
    expect(
      realModule.getAllowedSignupMethodsForEnvironment({
        convexCloudUrl: 'http://evil.com@127.0.0.1:3210',
        e2eSeedingEnabled: undefined,
      })
    ).toEqual(SELF_AND_INVITE);
  });

  it.each([
    ['hosted https deployment', 'https://happy-animal-123.convex.cloud'],
    ['https on loopback (TLS terminator, not a bare local instance)', 'https://127.0.0.1:3210'],
    ['loopback-looking subdomain', 'http://127.0.0.1.evil.com'],
    ['public host with loopback-looking userinfo', 'http://evil.com@8.8.8.8'],
    ['public 128.x address', 'http://128.0.0.1'],
    ['octet above 255', 'http://127.0.0.256'],
    ['subdomain of localhost', 'http://foo.localhost'],
    ['empty string', ''],
    ['not a URL', 'not a url'],
  ])('fails closed to invite-only for %s', (_label, convexCloudUrl) => {
    expect(
      realModule.getAllowedSignupMethodsForEnvironment({
        convexCloudUrl,
        e2eSeedingEnabled: undefined,
      })
    ).toEqual(INVITE_ONLY);
  });

  it('fails closed to invite-only when CONVEX_CLOUD_URL is missing', () => {
    expect(
      realModule.getAllowedSignupMethodsForEnvironment({
        convexCloudUrl: undefined,
        e2eSeedingEnabled: undefined,
      })
    ).toEqual(INVITE_ONLY);
  });

  it('allows self signup when E2E seeding is enabled, whatever the origin', () => {
    expect(
      realModule.getAllowedSignupMethodsForEnvironment({
        convexCloudUrl: 'https://happy-animal-123.convex.cloud',
        e2eSeedingEnabled: 'true',
      })
    ).toEqual(SELF_AND_INVITE);
    expect(
      realModule.getAllowedSignupMethodsForEnvironment({
        convexCloudUrl: undefined,
        e2eSeedingEnabled: 'true',
      })
    ).toEqual(SELF_AND_INVITE);
  });

  it.each([undefined, 'false'])(
    'keeps hosted deployments invite-only when E2E seeding is %s',
    (e2eSeedingEnabled) => {
      expect(
        realModule.getAllowedSignupMethodsForEnvironment({
          convexCloudUrl: 'https://happy-animal-123.convex.cloud',
          e2eSeedingEnabled,
        })
      ).toEqual(INVITE_ONLY);
    }
  );
});

describe('featureFlags.allowedSignupMethods getter', () => {
  it('reads CONVEX_CLOUD_URL and E2E_SEEDING_ENABLED from the runtime environment', () => {
    vi.stubEnv('E2E_SEEDING_ENABLED', '');

    vi.stubEnv('CONVEX_CLOUD_URL', 'http://127.0.0.1:3210');
    expect(realModule.featureFlags.allowedSignupMethods).toEqual(SELF_AND_INVITE);

    vi.stubEnv('CONVEX_CLOUD_URL', 'https://happy-animal-123.convex.cloud');
    expect(realModule.featureFlags.allowedSignupMethods).toEqual(INVITE_ONLY);

    vi.stubEnv('E2E_SEEDING_ENABLED', 'true');
    expect(realModule.featureFlags.allowedSignupMethods).toEqual(SELF_AND_INVITE);
  });

  it('ignores NODE_ENV and CONVEX_DEPLOYMENT, which the function runtime does not provide as signals', () => {
    vi.stubEnv('E2E_SEEDING_ENABLED', '');
    vi.stubEnv('CONVEX_CLOUD_URL', 'https://happy-animal-123.convex.cloud');
    vi.stubEnv('NODE_ENV', 'development');
    vi.stubEnv('CONVEX_DEPLOYMENT', 'local:chatroom');
    expect(realModule.featureFlags.allowedSignupMethods).toEqual(INVITE_ONLY);
  });
});
