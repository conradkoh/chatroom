/**
 * Use Case: Get Agent Config for Start
 *
 * Returns the data needed to populate the "Start Agent" form for a specific
 * role. Resolves defaults from the preference → teamConfig fallback chain
 * so the frontend doesn't need to merge data sources.
 *
 * machineId is intentionally exposed here because the user needs to select
 * which machine to start on — but it's scoped to this start-agent context,
 * not leaked into general status views.
 */

import type { Id } from '../../../../convex/_generated/dataModel';
import type { QueryCtx } from '../../../../convex/_generated/server';
import { buildTeamRoleKey } from '../../../../convex/utils/teamRoleKey';
import type { AgentHarness } from '../../entities/agent';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface ConnectedMachineView {
  machineId: string;
  hostname: string;
  availableHarnesses: AgentHarness[];
  availableModels: Record<string, string[]>;
}

export interface AgentStartDefaults {
  machineId?: string;
  agentHarness?: AgentHarness;
  model?: string;
  workingDir?: string;
}

export interface AgentStartFormData {
  role: string;
  connectedMachines: ConnectedMachineView[];
  defaults: AgentStartDefaults;
}

export interface GetAgentConfigForStartInput {
  chatroomId: Id<'chatroom_rooms'>;
  role: string;
  userId: Id<'users'>;
}

// ─── Use Case ────────────────────────────────────────────────────────────────

export async function getAgentConfigForStart(
  ctx: QueryCtx,
  input: GetAgentConfigForStartInput
): Promise<AgentStartFormData | null> {
  const chatroom = await ctx.db.get('chatroom_rooms', input.chatroomId);
  if (!chatroom || chatroom.ownerId !== input.userId) {
    return null;
  }

  // Get connected machines for this user
  const userMachines = await ctx.db
    .query('chatroom_machines')
    .withIndex('by_userId', (q) => q.eq('userId', input.userId))
    .collect();

  const connectedMachines: ConnectedMachineView[] = userMachines
    .filter((m) => m.daemonConnected)
    .map((m) => ({
      machineId: m.machineId,
      hostname: m.hostname,
      availableHarnesses: m.availableHarnesses as AgentHarness[],
      availableModels: (m.availableModels ?? {}) as Record<string, string[]>,
    }));

  // Resolve defaults using the priority chain:
  // 1. Agent preference (user's last-used config for this role)
  // 2. Team config (authoritative team-level config)

  const roleLower = input.role.toLowerCase();

  // 1. Check preference
  const preference = await ctx.db
    .query('chatroom_agentPreferences')
    .withIndex('by_userId_chatroom_role', (q) =>
      q.eq('userId', input.userId).eq('chatroomId', input.chatroomId).eq('role', roleLower)
    )
    .first();

  if (preference) {
    return {
      role: input.role,
      connectedMachines,
      defaults: {
        machineId: preference.machineId,
        agentHarness: preference.agentHarness as AgentHarness | undefined,
        model: preference.model,
        workingDir: preference.workingDir,
      },
    };
  }

  // 2. Check team config
  let teamConfig = null;
  if (chatroom.teamId) {
    const startTeamRoleKey = buildTeamRoleKey(chatroom._id, chatroom.teamId, input.role);
    teamConfig = await ctx.db
      .query('chatroom_teamAgentConfigs')
      .withIndex('by_teamRoleKey', (q) => q.eq('teamRoleKey', startTeamRoleKey))
      .first();
  }

  if (teamConfig?.machineId) {
    return {
      role: input.role,
      connectedMachines,
      defaults: {
        machineId: teamConfig.machineId,
        agentHarness: teamConfig.agentHarness as AgentHarness | undefined,
        model: teamConfig.model,
        workingDir: teamConfig.workingDir,
      },
    };
  }

  // No defaults available
  return {
    role: input.role,
    connectedMachines,
    defaults: {},
  };
}
