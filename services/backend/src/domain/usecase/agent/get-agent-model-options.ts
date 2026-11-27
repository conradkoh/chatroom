import { ConvexError } from 'convex/values';

import { type AgentConfigTarget } from './resolve-agent-config-target';
import { BACKEND_ERROR_CODES, type BackendError } from '../../../../config/errorCodes';
import type { Id } from '../../../../convex/_generated/dataModel';
import type { QueryCtx } from '../../../../convex/_generated/server';
import { getMachineAvailableModels } from '../machine/machine-available-models';

export interface AgentModelOptions {
  chatroomId: Id<'chatroom_rooms'>;
  teamId: string;
  role: string;
  machineId: string;
  workspaceId: Id<'chatroom_workspaces'>;
  workingDir: string;
  current: { agentHarness: string; model: string } | null;
  /** Only harnesses available on the machine, in capabilities order */
  harnesses: { harness: string; models: string[]; isCurrent: boolean }[];
}

/** Read-only harness/model options for one role: the machine catalog plus the current config. */
// fallow-ignore-next-line complexity
export async function getAgentModelOptions(
  ctx: QueryCtx,
  input: {
    target: AgentConfigTarget;
    chatroomId: Id<'chatroom_rooms'>;
    harness?: string | undefined;
  }
): Promise<AgentModelOptions> {
  const { target } = input;
  const capabilities = await ctx.db
    .query('chatroom_machineCapabilities')
    .withIndex('by_machineId', (q) => q.eq('machineId', target.machineId))
    .first();
  const available = capabilities?.availableHarnesses ?? [];
  if (input.harness !== undefined && !available.some((candidate) => candidate === input.harness)) {
    throw new ConvexError<BackendError>({
      code: BACKEND_ERROR_CODES.AGENT_CONFIG_HARNESS_UNAVAILABLE,
      message: `Agent harness '${input.harness}' is not available on this machine. Available: ${available.join(', ') || 'none'}`,
    });
  }
  // Keep the existing @deprecated fallback: capability-row models predate chatroom_machineAvailableModels.
  const catalog =
    (await getMachineAvailableModels(ctx, target.machineId)) ?? capabilities?.availableModels ?? {};
  const current = target.previous
    ? { agentHarness: target.previous.agentHarness, model: target.previous.model }
    : null;
  return {
    chatroomId: input.chatroomId,
    teamId: target.teamId,
    role: target.role,
    machineId: target.machineId,
    workspaceId: target.workspace._id,
    workingDir: target.workingDir,
    current,
    harnesses: available
      .filter((harness) => input.harness === undefined || harness === input.harness)
      .map((harness) => ({
        harness,
        models: catalog[harness] ?? [],
        isCurrent: current?.agentHarness === harness,
      })),
  };
}
