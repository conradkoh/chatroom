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

  // Read connection status from machineStatus table (transition-driven, not heartbeat-driven)
  const connectedMachines: ConnectedMachineView[] = [];
  for (const m of userMachines) {
    const machineStatus = await ctx.db
      .query('chatroom_machineStatus')
      .withIndex('by_machineId', (q: any) => q.eq('machineId', m.machineId))
      .first();
    if (machineStatus?.status === 'online') {
      connectedMachines.push({
        machineId: m.machineId,
        hostname: m.hostname,
        availableHarnesses: m.availableHarnesses as AgentHarness[],
        availableModels: (m.availableModels ?? {}) as Record<string, string[]>,
      });
    }
  }

  // Resolve defaults from the authoritative team-level config.

  // Check team config
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
