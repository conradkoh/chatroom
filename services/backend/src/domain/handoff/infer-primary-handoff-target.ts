/**
 * Infer the primary handoff target for task delivery next-steps.
 *
 * Recommendation only: this function selects the recommended recipient for
 * step 2 of the next-steps section. It never authorizes a handoff and never
 * removes targets — alternate team capabilities are supplied separately via
 * `availableHandoffTargets` and rendered without mode filtering. Backend
 * handoff authorization is enforced elsewhere against configured team roles.
 *
 * Default: return work to the task sender. Entry point receiving team-member
 * work delivers to `user` (rework to builder remains in `<handoffs>`).
 */

import type { ConversationMode } from '@workspace/shared/domain/conversation-mode';

export interface InferPrimaryHandoffTargetParams {
  senderRole: string | undefined;
  role: string;
  availableHandoffTargets: string[];
  /** True when this role is the team entry point (e.g. duo planner). */
  isEntryPoint?: boolean | undefined;
  /** When true, entry-point tasks from user must check in with enhancer first. */
  plannerEnhancerEnabled?: boolean | undefined;
  /**
   * Explicit conversation mode snapshot. When present, takes precedence over
   * the legacy boolean for enhancer eligibility:
   * - `chat`: entry-point user tasks target `user` directly (no enhancer).
   *   This is a recommendation only — advertised team capabilities (e.g.
   *   builder) are preserved in `<handoffs>` by the caller.
   * - `code:enhanced`: retain enhancer targeting when available.
   * - `code` / omitted: retain existing boolean behaviour.
   */
  conversationMode?: ConversationMode | undefined;
}

// fallow-ignore-next-line complexity
export function inferPrimaryHandoffTarget(
  params: InferPrimaryHandoffTargetParams
): string | undefined {
  const {
    senderRole,
    role,
    availableHandoffTargets,
    isEntryPoint,
    plannerEnhancerEnabled,
    conversationMode,
  } = params;

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

  // Resolve enhancer eligibility: explicit mode takes precedence over legacy boolean.
  const shouldUseEnhancer = conversationMode
    ? conversationMode === 'code:enhanced'
    : plannerEnhancerEnabled === true;

  if (
    shouldUseEnhancer &&
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
