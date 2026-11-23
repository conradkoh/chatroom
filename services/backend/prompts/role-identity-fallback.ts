import { isEphemeralAgentRole, isRetiredAgentRole } from '@workspace/shared/domain/agent-role';

import type { RoleIdentity } from './types/role-identity';

const TESTER_IDENTITY: RoleIdentity = {
  title: 'Tester',
  description: 'You are the QA role responsible for testing and validation.',
};

const EPHEMERAL_ROLE_IDENTITY: RoleIdentity = {
  title: 'Ephemeral Agent',
  description:
    'You are an ephemeral team agent. Complete the assigned task using the configured team workflow, then hand off when the task is complete.',
};

/**
 * Identity for a role that no team catalogue or legacy entry defines.
 * `role` keeps its original casing in the generic text (legacy behaviour).
 */
export function resolveFallbackRoleIdentity(role: string): RoleIdentity {
  const normalizedRole = role.toLowerCase();
  if (normalizedRole === 'tester') return TESTER_IDENTITY;
  if (isEphemeralAgentRole(normalizedRole) || isRetiredAgentRole(normalizedRole)) {
    return EPHEMERAL_ROLE_IDENTITY;
  }
  return {
    title: role.charAt(0).toUpperCase() + role.slice(1),
    description: `You are participating as the ${role} in this collaborative workflow.`,
  };
}
