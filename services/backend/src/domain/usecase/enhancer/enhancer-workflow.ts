/** The one-time, request-first advisory pass for an originating user message. */
export function getEnhancerRequestFirstWorkflow(entryPointRole: string): string {
  return `user → enhancer → ${entryPointRole.toLowerCase()}`;
}

/** Full user-instruction flow when enhancer is enabled. */
export function getEnhancerEnabledUserWorkflow(
  entryPointRole: string,
  hasBuilder: boolean
): string {
  const requestFirst = getEnhancerRequestFirstWorkflow(entryPointRole);
  return hasBuilder
    ? `${requestFirst} → [loop builder → ${entryPointRole.toLowerCase()}] → user`
    : `${requestFirst} → user`;
}

/** Full user-instruction flow when enhancer is disabled. */
export const ENHANCER_DISABLED_USER_WORKFLOW = 'user → [loop planner → builder → planner] → user';
