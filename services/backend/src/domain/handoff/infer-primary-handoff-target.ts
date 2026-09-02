/**
 * Infer the primary handoff target for task delivery next-steps.
 *
 * Default: return work to the task sender. Entry point receiving team-member
 * work delivers to `user` (rework to builder remains in `<handoffs>`).
 */

export interface InferPrimaryHandoffTargetParams {
  senderRole: string | undefined;
  role: string;
  availableHandoffTargets: string[];
  /** True when this role is the team entry point (e.g. duo planner). */
  isEntryPoint?: boolean | undefined;
  /** When true, entry-point tasks from user must check in with enhancer first. */
  plannerEnhancerEnabled?: boolean | undefined;
}

// fallow-ignore-next-line complexity
export function inferPrimaryHandoffTarget(
  params: InferPrimaryHandoffTargetParams
): string | undefined {
  const { senderRole, role, availableHandoffTargets, isEntryPoint, plannerEnhancerEnabled } =
    params;

  if (availableHandoffTargets.length === 0) {
    return undefined;
  }

  if (!senderRole) {
    return availableHandoffTargets[0];
  }

  const normalizedSender = senderRole.toLowerCase();
  const normalizedRole = role.toLowerCase();

  if (normalizedSender === normalizedRole) {
    return availableHandoffTargets[0];
  }

  if (
    isEntryPoint &&
    normalizedSender === 'enhancer' &&
    availableHandoffTargets.some((target) => target.toLowerCase() === 'builder')
  ) {
    return 'builder';
  }

  if (
    plannerEnhancerEnabled &&
    isEntryPoint &&
    normalizedSender === 'user' &&
    availableHandoffTargets.some((target) => target.toLowerCase() === 'enhancer')
  ) {
    return 'enhancer';
  }

  if (
    isEntryPoint &&
    normalizedSender !== 'user' &&
    availableHandoffTargets.some((target) => target.toLowerCase() === 'user')
  ) {
    return 'user';
  }

  return senderRole;
}
