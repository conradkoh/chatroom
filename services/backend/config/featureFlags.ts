import type { SignupMethod } from './signupMethods';

/**
 * Runtime feature flags for the backend.
 *
 * ⚠️  DO NOT import this from the webapp (`apps/webapp/`).
 *     The webapp renders UI unconditionally for released features.
 */

export const featureFlags = {
  disableLogin: false,
  /** Direct-harness sessions feature. Always on; kill-switch via requireDirectHarnessWorkers helper. */
  directHarnessWorkers: true,
  /** null or [] = signups disabled. Default ['self'] preserves current open self-signup. */
  allowedSignupMethods: ['self'] as SignupMethod[] | null,
};
