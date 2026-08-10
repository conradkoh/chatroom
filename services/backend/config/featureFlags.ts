import type { SignupMethod } from './signupMethods';

/**
 * Runtime feature flags for the backend.
 *
 * ⚠️  DO NOT import this from the webapp (`apps/webapp/`).
 *     The webapp renders UI unconditionally for released features.
 */

const DEV_NODE_ENVS = new Set(['development', 'test']);

/**
 * Signup methods allowed for a given backend runtime environment.
 *
 * Local Convex deployments (`CONVEX_DEPLOYMENT` starting with `local:`) always
 * allow self signup. This is what lets `pnpm local` self-register even though it
 * launches the webapp with `NODE_ENV=production`, so the deployment marker is
 * the reliable signal for local mode — not NODE_ENV on its own.
 *
 * Non-production dev node environments also allow self signup. Everything else
 * (production and unknown/missing environment markers) fails closed to
 * invite-only.
 */
// Exported so config/featureFlags.spec.ts can cover every branch without
// mutating process state; the getter below is the only runtime consumer.
// fallow-ignore-next-line unused-export
export function getAllowedSignupMethodsForEnvironment(
  nodeEnv: string | undefined,
  convexDeployment: string | undefined
): SignupMethod[] {
  if (convexDeployment?.startsWith('local:')) {
    return ['self', 'invite'];
  }
  if (nodeEnv && DEV_NODE_ENVS.has(nodeEnv)) {
    return ['self', 'invite'];
  }
  return ['invite'];
}

export const featureFlags = {
  disableLogin: false,
  /** Direct-harness sessions feature. Always on; kill-switch via requireDirectHarnessWorkers helper. */
  directHarnessWorkers: true,
  /** null or [] = signups disabled. ['invite'] = invite-only registration. */
  get allowedSignupMethods(): SignupMethod[] | null {
    return getAllowedSignupMethodsForEnvironment(
      process.env.NODE_ENV,
      process.env.CONVEX_DEPLOYMENT
    );
  },
};
