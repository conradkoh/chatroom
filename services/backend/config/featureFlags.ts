import type { SignupMethod } from './signupMethods';

/**
 * Runtime feature flags for the backend.
 *
 * ⚠️  DO NOT import this from the webapp (`apps/webapp/`).
 *     The webapp renders UI unconditionally for released features.
 *
 * Runtime env contract (the Convex function runtime):
 * - `CONVEX_CLOUD_URL` and `CONVEX_SITE_URL` are set by the platform or the self-hosting
 *   operator for this deployment. Request data cannot set them.
 * - `CONVEX_DEPLOYMENT` is NOT set in the function runtime, and `NODE_ENV` is `production`.
 *   Never branch on either of them.
 * - `E2E_SEEDING_ENABLED=true` is an explicit operator opt-in for CI and disposable deployments.
 *
 * Signup policy: self signup is allowed when E2E seeding is enabled, or when the deployment
 * advertises a loopback `http` origin (a local instance such as `pnpm local`). Everything else,
 * including hosted `https://*.convex.cloud` deployments and missing or malformed values, is
 * invite-only.
 */

/**
 * True only for an `http:` URL whose hostname is `localhost`, `[::1]`, or `127.a.b.c` with every
 * octet <= 255. `https:`, wildcard or suffix hosts (`http://127.0.0.1.evil.com`) are rejected.
 * Only the parsed host decides: `http://evil.com@127.0.0.1:3210` is loopback by hostname.
 */
// The branch count is intentional: each guard is a fail-closed rule for a distinct hostile input
// (absent, unparseable, non-http, non-loopback host). Kept in one place so the policy is auditable.
// fallow-ignore-next-line complexity
function isLoopbackHttpOrigin(raw: string | undefined): boolean {
  if (!raw) return false;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return false;
  }
  if (url.protocol !== 'http:') return false;
  const host = url.hostname;
  if (host === 'localhost' || host === '[::1]') return true;
  const match = /^127\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  return match !== null && match.slice(1).every((octet) => Number(octet) <= 255);
}

/**
 * Signup methods allowed for a given backend runtime environment. Fails closed to invite-only.
 */
// Exported so config/featureFlags.spec.ts can cover every branch without
// mutating process state; the getter below is the only runtime consumer.
// fallow-ignore-next-line unused-export
export function getAllowedSignupMethodsForEnvironment(env: {
  convexCloudUrl: string | undefined;
  e2eSeedingEnabled: string | undefined;
}): SignupMethod[] {
  if (env.e2eSeedingEnabled === 'true') {
    return ['self', 'invite'];
  }
  if (isLoopbackHttpOrigin(env.convexCloudUrl)) {
    return ['self', 'invite'];
  }
  return ['invite'];
}

export const featureFlags = {
  disableLogin: false,
  /** null or [] = signups disabled. ['invite'] = invite-only registration. */
  get allowedSignupMethods(): SignupMethod[] | null {
    return getAllowedSignupMethodsForEnvironment({
      convexCloudUrl: process.env.CONVEX_CLOUD_URL,
      e2eSeedingEnabled: process.env.E2E_SEEDING_ENABLED,
    });
  },
};
