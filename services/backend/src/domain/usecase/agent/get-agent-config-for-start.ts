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

import { getLastSentLaunchRequestForRole } from './get-last-sent-launch-request';
import type { Id } from '../../../../convex/_generated/dataModel';
import type { QueryCtx } from '../../../../convex/_generated/server';
import type { AgentHarness } from '../../entities/agent';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface ConnectedMachineView {
  machineId: string;
  hostname: string;
  availableHarnesses: AgentHarness[];
  availableModels: Record<string, string[]>;
}

export interface AgentStartDefaults {
  machineId?: string | undefined;
  agentHarness?: AgentHarness | undefined;
  model?: string | undefined;
  workingDir?: string | undefined;
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

  // Get registered machines for this user. Daemon connectivity is surfaced
  // separately and must not determine which machine configurations are
  // available to the start form.
  const userMachines = await ctx.db
    .query('chatroom_machines')
    .withIndex('by_userId', (q) => q.eq('userId', input.userId))
    .collect();

  const connectedMachines: ConnectedMachineView[] = await Promise.all(
    userMachines.map(async (m) => {
      const capabilities = await ctx.db
        .query('chatroom_machineCapabilities')
        .withIndex('by_machineId', (q) => q.eq('machineId', m.machineId))
        .first();
      return {
        machineId: m.machineId,
        hostname: m.hostname,
        availableHarnesses: (capabilities?.availableHarnesses ?? []) as AgentHarness[],
        availableModels: capabilities?.availableModels ?? {},
      };
    })
  );

  const lastSentRequest = await getLastSentLaunchRequestForRole(ctx, {
    chatroomId: input.chatroomId,
    role: input.role,
  });

  if (lastSentRequest) {
    return {
      role: input.role,
      connectedMachines,
      defaults: {
        machineId: lastSentRequest.machineId,
        agentHarness: lastSentRequest.agentHarness as AgentHarness,
        model: lastSentRequest.model,
        workingDir: lastSentRequest.workingDir,
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
