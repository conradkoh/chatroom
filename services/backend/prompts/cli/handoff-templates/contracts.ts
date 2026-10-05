/**
 * Shared types for role-owned handoff contracts and the reciprocity validator.
 *
 * Handoff template prose stays in the existing pair getter files; each role
 * module composes those getters into its own outbound contract. This module is
 * the single source of truth for the contract shape and for validating that
 * agent-to-agent contracts are reciprocal.
 */

import type { BuiltinTeamRole } from '@workspace/shared/domain/agent-role';
import { CHATROOM_ROLE_USER, type ChatroomUserRole } from '@workspace/shared/domain/chatroom-role';
import type { ConversationMode } from '@workspace/shared/domain/conversation-mode';
import type { TeamPresetId } from '@workspace/shared/domain/team-kind';
import { TEAM_PRESETS } from '@workspace/shared/domain/team-presets';

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
export interface RoleHandoffContract<R extends string = string, Target extends string = string> {
  role: R;
  receivesFrom: readonly Target[];
  returnsTo: readonly Target[];
  outboundTemplates: Readonly<Partial<Record<Target, HandoffTemplateGetter>>>;
}

export type BuiltinTeamRoleHandoffContract<
  T extends TeamPresetId,
  R extends BuiltinTeamRole<T>,
> = RoleHandoffContract<R, BuiltinTeamRole<T> | ChatroomUserRole>;

export type BuiltinTeamHandoffCatalog<T extends TeamPresetId> = {
  [R in BuiltinTeamRole<T>]: BuiltinTeamRoleHandoffContract<T, R>;
};

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
// Public generic validator remains available for custom catalogs.
// fallow-ignore-next-line unused-export complexity
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

// fallow-ignore-next-line complexity
function validateBuiltinOwners(
  teamName: string,
  expectedRoles: ReadonlySet<string>,
  contracts: readonly RoleHandoffContract[]
): Map<string, RoleHandoffContract> {
  const actualRoles = new Set<string>();
  const byRole = new Map<string, RoleHandoffContract>();

  for (const contract of contracts) {
    const normalizedOwner = contract.role.trim().toLowerCase();
    if (!normalizedOwner || contract.role !== normalizedOwner) {
      throw new Error(`${teamName} handoff owner "${contract.role}" is not canonical`);
    }
    if (actualRoles.has(normalizedOwner)) {
      throw new Error(`${teamName} has duplicate handoff contract owner "${contract.role}"`);
    }
    if (!expectedRoles.has(normalizedOwner)) {
      throw new Error(`${teamName} has unexpected handoff contract role "${contract.role}"`);
    }
    actualRoles.add(normalizedOwner);
    byRole.set(normalizedOwner, contract);
  }

  for (const role of expectedRoles) {
    if (!actualRoles.has(role)) {
      throw new Error(`${teamName} is missing handoff contract for role "${role}"`);
    }
  }

  return byRole;
}

// fallow-ignore-next-line complexity
function validateReferenceTargets(
  teamName: string,
  owner: string,
  label: string,
  targets: readonly string[],
  allowedTargets: ReadonlySet<string>
): void {
  const seen = new Set<string>();
  for (const target of targets) {
    const normalizedTarget = target.trim().toLowerCase();
    if (target !== normalizedTarget || !allowedTargets.has(normalizedTarget)) {
      throw new Error(`${teamName} role "${owner}" has invalid ${label} target "${target}"`);
    }
    if (seen.has(normalizedTarget)) {
      throw new Error(`${teamName} role "${owner}" has duplicate ${label} target "${target}"`);
    }
    seen.add(normalizedTarget);
  }
}

// fallow-ignore-next-line complexity
function validateBuiltinReferences(
  teamName: string,
  allowedTargets: ReadonlySet<string>,
  contracts: readonly RoleHandoffContract[]
): void {
  for (const contract of contracts) {
    const owner = contract.role;
    validateReferenceTargets(
      teamName,
      owner,
      'receivesFrom',
      contract.receivesFrom,
      allowedTargets
    );
    validateReferenceTargets(teamName, owner, 'returnsTo', contract.returnsTo, allowedTargets);

    const outboundTargets = Object.keys(contract.outboundTemplates);
    if (outboundTargets.length === 0) {
      throw new Error(`${teamName} role "${owner}" must have an outbound handoff capability`);
    }
    const returnsTo = new Set(contract.returnsTo);
    const outbound = new Set(outboundTargets);
    validateReferenceTargets(teamName, owner, 'outbound', outboundTargets, allowedTargets);
    for (const target of outboundTargets) {
      if (typeof contract.outboundTemplates[target] !== 'function') {
        throw new Error(
          `${teamName} role "${owner}" has no outbound getter for target "${target}"`
        );
      }
    }
    if (
      returnsTo.size !== outbound.size ||
      [...returnsTo].some((target) => !outbound.has(target))
    ) {
      throw new Error(
        `${teamName} role "${owner}" returnsTo targets must exactly match outbound targets`
      );
    }
  }
}

// fallow-ignore-next-line complexity
function validateBuiltinReciprocity(
  teamName: string,
  byRole: ReadonlyMap<string, RoleHandoffContract>,
  contracts: readonly RoleHandoffContract[]
): void {
  for (const contract of contracts) {
    const owner = contract.role;
    for (const receivedFrom of contract.receivesFrom) {
      if (receivedFrom === CHATROOM_ROLE_USER) continue;
      const source = byRole.get(receivedFrom);
      if (!source?.outboundTemplates[owner]) {
        throw new Error(
          `${teamName} role "${owner}" receives from "${receivedFrom}" without a reverse outbound edge`
        );
      }
    }
  }

  try {
    validateRoleHandoffContracts(contracts);
  } catch (error) {
    const contextualError = new Error(
      `${teamName}: ${error instanceof Error ? error.message : String(error)}`
    );
    Object.defineProperty(contextualError, 'cause', { value: error, configurable: true });
    throw contextualError;
  }
}

/** Enforces builtin team membership and coherent role-owned handoff capabilities. */
export function validateBuiltinTeamRoleHandoffContracts(
  teamId: TeamPresetId,
  contracts: readonly RoleHandoffContract[]
): void {
  const teamName = TEAM_PRESETS[teamId].name;
  const expectedRoles = new Set<string>(TEAM_PRESETS[teamId].roles);
  const byRole = validateBuiltinOwners(teamName, expectedRoles, contracts);
  const allowedTargets = new Set<string>([...expectedRoles, CHATROOM_ROLE_USER]);
  validateBuiltinReferences(teamName, allowedTargets, contracts);
  validateBuiltinReciprocity(teamName, byRole, contracts);
}
