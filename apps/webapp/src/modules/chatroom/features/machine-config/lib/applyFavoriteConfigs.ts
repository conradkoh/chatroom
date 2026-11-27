import type { Id } from '@workspace/backend/convex/_generated/dataModel';

import type { ApplyConfigOutcome, ApplyTopFavoritesResult } from './topFavoriteModels';
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

/** Arguments of `agents.applyConfig` without the session id. Machine and working dir are derived server-side. */
export interface ApplyConfigArgs {
  chatroomId: Id<'chatroom_rooms'>;
  workspaceId: Id<'chatroom_workspaces'>;
  role: string;
  agentHarness: AgentHarness;
  model: string;
}

interface Settled<T> {
  applied: { item: ApplyFavoriteConfigItem; value: T }[];
  failed: { role: string; message: string }[];
}

/** Runs `run` for every item, settling each independently; failures keep the backend message. */
async function settleItems<T>(
  items: readonly ApplyFavoriteConfigItem[],
  run: (item: ApplyFavoriteConfigItem) => Promise<T>,
  fallbackMessage: string
): Promise<Settled<T>> {
  const settled = await Promise.allSettled(items.map(async (item) => run(item)));
  const result: Settled<T> = { applied: [], failed: [] };
  settled.forEach((outcome, index) => {
    const item = items[index];
    if (outcome.status === 'fulfilled') result.applied.push({ item, value: outcome.value });
    else
      result.failed.push({
        role: item.role,
        message: getErrorMessage(outcome.reason, fallbackMessage),
      });
  });
  return result;
}

function toSaveArgs(item: ApplyFavoriteConfigItem): SaveConfigArgs {
  return {
    chatroomId: item.chatroomId,
    workspaceId: item.workspaceId,
    role: item.role,
    machineId: item.machineId,
    agentHarness: item.entry.agentHarness,
    model: item.entry.model,
    workingDir: item.workingDir,
  };
}

function toApplyConfigArgs(item: ApplyFavoriteConfigItem): ApplyConfigArgs {
  return {
    chatroomId: item.chatroomId,
    workspaceId: item.workspaceId,
    role: item.role,
    agentHarness: item.entry.agentHarness,
    model: item.entry.model,
  };
}

/** Saves every item's favourite with `saveConfig` (save only; the start flow relies on this). */
export async function applyFavoriteConfigs(
  saveConfig: (args: SaveConfigArgs) => Promise<unknown>,
  items: readonly ApplyFavoriteConfigItem[]
): Promise<ApplyTopFavoritesResult> {
  const settled = await settleItems(
    items,
    (item) => saveConfig(toSaveArgs(item)),
    'Failed to save configuration'
  );
  return {
    applied: settled.applied.map(({ item }) => ({ role: item.role, entry: item.entry })),
    failed: settled.failed,
  };
}

/** Applies every item's favourite with `agents.applyConfig`; the server restarts only changed running agents. */
export async function applyFavoriteConfigsAndRestart(
  applyConfig: (args: ApplyConfigArgs) => Promise<{ outcome: ApplyConfigOutcome }>,
  items: readonly ApplyFavoriteConfigItem[]
): Promise<ApplyTopFavoritesResult> {
  const settled = await settleItems(
    items,
    (item) => applyConfig(toApplyConfigArgs(item)),
    'Failed to apply configuration'
  );
  return {
    applied: settled.applied.map(({ item, value }) => ({
      role: item.role,
      entry: item.entry,
      outcome: value.outcome,
    })),
    failed: settled.failed,
  };
}
