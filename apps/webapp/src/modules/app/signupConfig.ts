import { getSignupConfigLabel, SignupMethod } from '@workspace/backend/config/signupMethods';

/**
 * Signup configuration derived from the backend's resolved signup methods
 * (`api.appinfo.get` → `allowedSignupMethods`). Pure: no env, no React.
 */
export interface SignupConfig {
  /** Methods the backend accepts (copied). */
  methods: SignupMethod[];
  /** At least one signup method is accepted. */
  signupAllowed: boolean;
  selfSignupAllowed: boolean;
  inviteSignupAllowed: boolean;
  /** Invite is the only accepted method. */
  inviteOnlyMode: boolean;
  /** Human-readable label, e.g. "Open (self)". */
  label: string;
}

/**
 * Derives every signup boolean and the label from one methods array.
 * `undefined` means the backend predates `allowedSignupMethods`: fail closed to invite-only.
 */
export function deriveSignupConfig(methods: readonly SignupMethod[] | undefined): SignupConfig {
  const resolved: SignupMethod[] = methods ? [...methods] : [SignupMethod.Invite];
  const selfSignupAllowed = resolved.includes(SignupMethod.Self);
  const inviteSignupAllowed = resolved.includes(SignupMethod.Invite);
  return {
    methods: resolved,
    signupAllowed: resolved.length > 0,
    selfSignupAllowed,
    inviteSignupAllowed,
    inviteOnlyMode: inviteSignupAllowed && !selfSignupAllowed,
    label: getSignupConfigLabel(resolved),
  };
}
