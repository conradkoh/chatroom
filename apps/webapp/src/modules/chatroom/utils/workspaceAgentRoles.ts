import type { AgentRoleLifecycleTag } from '@workspace/shared/domain/agent-role';
import type { TeamStructure } from '@workspace/shared/domain/team-presets';

export interface WorkspaceAgentRole {
  role: string;
  lifecycle: AgentRoleLifecycleTag;
  optional: boolean;
  teamId: string | null;
}

/** Builds the workspace agent directory from the static team structure only. */
export function getWorkspaceAgentRoles(
  teamStructure: TeamStructure | null | undefined
): WorkspaceAgentRole[] {
  return (teamStructure?.roles ?? [])
    .filter(({ role }) => role.toLowerCase() !== 'user')
    .map(({ role, lifecycle, optional }) => ({
      role,
      lifecycle,
      optional,
      teamId: teamStructure?.teamId ?? null,
    }));
}
