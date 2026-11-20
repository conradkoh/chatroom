import type { Id } from '@workspace/backend/convex/_generated/dataModel';

import type { ApplyTopFavoritesResult } from './topFavoriteModels';
import type { AgentHarness } from '../../../types/machine';
import type { MachineConfigEntry } from '../types/machineConfig';

import { getErrorMessage } from '@/lib/convexError';

/** One role's favourite to save into one workspace. */
export interface ApplyFavoriteConfigItem {
  chatroomId: Id<'chatroom_rooms'>;
  workspaceId: Id<'chatroom_workspaces'>;
  machineId: string;
  workingDir: string;
  role: string;
  entry: MachineConfigEntry;
}

/** Arguments of `agents.saveConfig` without the session id (added by `useSessionMutation`). */
export interface SaveConfigArgs {
  chatroomId: Id<'chatroom_rooms'>;
  workspaceId: Id<'chatroom_workspaces'>;
  role: string;
  machineId: string;
  agentHarness: AgentHarness;
  model: string;
  workingDir: string;
}

/**
 * Saves every item's favourite with `saveConfig`, settling each save independently.
 * Applied entries are reported as `{ role, entry }`; failures carry the backend message.
 */
export async function applyFavoriteConfigs(
  saveConfig: (args: SaveConfigArgs) => Promise<unknown>,
  items: readonly ApplyFavoriteConfigItem[]
): Promise<ApplyTopFavoritesResult> {
  const settled = await Promise.allSettled(
    items.map(async (item) =>
      saveConfig({
        chatroomId: item.chatroomId,
        workspaceId: item.workspaceId,
        role: item.role,
        machineId: item.machineId,
        agentHarness: item.entry.agentHarness,
        model: item.entry.model,
        workingDir: item.workingDir,
      })
    )
  );
  const result: ApplyTopFavoritesResult = { applied: [], failed: [] };
  settled.forEach((outcome, index) => {
    const { role, entry } = items[index];
    if (outcome.status === 'fulfilled') result.applied.push({ role, entry });
    else
      result.failed.push({
        role,
        message: getErrorMessage(outcome.reason, 'Failed to save configuration'),
      });
  });
  return result;
}
