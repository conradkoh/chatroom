import { featureFlags } from './featureFlags';

export const SignupMethod = {
  Self: 'self',
  Invite: 'invite',
} as const;

export type SignupMethod = (typeof SignupMethod)[keyof typeof SignupMethod];

export const SIGNUP_METHODS = [SignupMethod.Self, SignupMethod.Invite] as const;

export function getAllowedSignupMethods(): SignupMethod[] {
  const raw = featureFlags.allowedSignupMethods;
  if (!raw?.length) return [];
  return raw.filter((m): m is SignupMethod => (SIGNUP_METHODS as readonly string[]).includes(m));
}

export function isSignupAllowed(): boolean {
  return getAllowedSignupMethods().length > 0;
}

export function isSelfSignupAllowed(): boolean {
  return getAllowedSignupMethods().includes(SignupMethod.Self);
}

export function isInviteSignupAllowed(): boolean {
  return getAllowedSignupMethods().includes(SignupMethod.Invite);
}

export function getSignupConfigLabel(): string {
  const methods = getAllowedSignupMethods();
  if (methods.length === 0) return 'Disabled';
  if (methods.length === 2) return 'Self + Invite';
  if (methods[0] === SignupMethod.Invite) return 'Invite only';
  return 'Open (self)';
}
