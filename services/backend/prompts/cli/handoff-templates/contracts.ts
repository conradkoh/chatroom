/**
 * Shared types for role-owned handoff contracts and the reciprocity validator.
 *
 * Handoff template prose stays in the existing pair getter files; each role
 * module composes those getters into its own outbound contract. This module is
 * the single source of truth for the contract shape and for validating that
 * agent-to-agent contracts are reciprocal.
 */

import type { ConversationMode } from '@workspace/shared/domain/conversation-mode';

/** Query handed to a handoff template getter (compat shape used by all getters). */
export interface HandoffTemplateQuery {
  fromRole: string;
  toRole: string;
  teamId?: string | undefined;
  nativeIntegration?: boolean | undefined;
  chatroomId?: string | undefined;
  role?: string | undefined;
  cliEnvPrefix?: string | undefined;
  conversationMode?: ConversationMode | undefined;
}

export type HandoffTemplateGetter = (query: HandoffTemplateQuery) => string | null;

/** Role-owned declaration of who a role hands off to / receives from. */
export interface RoleHandoffContract {
  role: string;
  receivesFrom: readonly string[];
  returnsTo: readonly string[];
  outboundTemplates: Readonly<Record<string, HandoffTemplateGetter>>;
}

/** One renderable outbound mapping in a role listing. */
export interface HandoffTemplateDescriptor {
  fromRole: string;
  toRole: string;
  template: string;
}

/**
 * Validates a team's role-handoff catalog. Throws a descriptive Error for:
 * - duplicate role names (case-insensitive);
 * - an outbound target that is neither `user` nor another contract in the
 *   catalog;
 * - a missing reciprocal `receivesFrom` declaration (role A's outbound target
 *   is catalog role B, but B does not declare A in `receivesFrom`).
 *
 * `user` is an external terminal target and never needs to be a catalog role.
 */
// fallow-ignore-next-line complexity
export function validateRoleHandoffContracts(contracts: readonly RoleHandoffContract[]): void {
  const byRole = new Map<string, RoleHandoffContract>();
  for (const contract of contracts) {
    const key = contract.role.toLowerCase();
    if (byRole.has(key)) {
      throw new Error(`Duplicate role handoff contract: "${contract.role}"`);
    }
    byRole.set(key, contract);
  }

  for (const contract of contracts) {
    const ownerKey = contract.role.toLowerCase();
    for (const target of Object.keys(contract.outboundTemplates)) {
      const targetKey = target.toLowerCase();
      if (targetKey === 'user') continue;
      const targetContract = byRole.get(targetKey);
      if (!targetContract) {
        throw new Error(
          `Role "${contract.role}" declares an outbound template to "${target}", which is neither 'user' nor a role listed in the catalogue`
        );
      }
      const declaresOwner = (targetContract.receivesFrom ?? []).some(
        (from) => from.toLowerCase() === ownerKey
      );
      if (!declaresOwner) {
        throw new Error(
          `Reciprocity failure: role "${targetContract.role}" receives from "${contract.role}" (via the ${contract.role} → ${target} template) but does not declare "${contract.role}" in receivesFrom`
        );
      }
    }
  }
}
