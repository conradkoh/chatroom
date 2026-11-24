/** Role name of the verifier. Its rendered prompts reference log message ids only. */
const VERIFIER_ROLE = 'verifier';

/** True when `role` is the verifier (trimmed, case-insensitive). */
export function isVerifierRole(role: string): boolean {
  return role.trim().toLowerCase() === VERIFIER_ROLE;
}
