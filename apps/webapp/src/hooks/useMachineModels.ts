/**
 * Hook to fetch per-machine available model lists from the chatroom_machineModels table.
 *
 * Extracted from chatroom_machines.availableModels in v1.38.4 to prevent the heavy
 * ~50KB payload from riding on listMachines re-pushes (see chatroom_machineModels
 * schema entry for full rationale).
 *
 * Keep this hook tiny — single thin wrapper, one subscription per call site.
 * AgentConfigTabs renders one machine at a time in the settings modal; one
 * subscription is sufficient. Do NOT add fixed-slot or multi-machine patterns here.
 */

'use client';

import { api } from '@workspace/backend/convex/_generated/api';
import { mergeCursorSdkListedModels } from '@workspace/backend/src/domain/entities/harness/cursor-sdk.config';
import { useSessionQuery } from 'convex-helpers/react/sessions';

export interface UseMachineModelsResult {
  /** Harness → model IDs (e.g. `{ opencode: ['provider/claude-4'], pi: [...] }`) */
  availableModels: Record<string, string[]>;
  /** True while loading models for the requested machineId */
  isLoading: boolean;
}

function augmentCursorSdkModels(
  availableModels: Record<string, string[]>
): Record<string, string[]> {
  const cursorSdkModels = availableModels['cursor-sdk'];
  if (cursorSdkModels === undefined) return availableModels;

  const merged = mergeCursorSdkListedModels(cursorSdkModels);
  if (
    merged.length === cursorSdkModels.length &&
    merged.every((model, index) => model === cursorSdkModels[index])
  ) {
    return availableModels;
  }

  return { ...availableModels, 'cursor-sdk': merged };
}

/**
 * Returns available models for a machine and a loading flag for the current query.
 *
 * @param machineId - The machine UUID to query, or undefined when no machine is selected
 */
export function useMachineModels(machineId: string | undefined): UseMachineModelsResult {
  const result = useSessionQuery(api.machines.getMachineModels, machineId ? { machineId } : 'skip');
  const availableModels = result?.availableModels ?? {};
  return {
    availableModels: augmentCursorSdkModels(availableModels),
    isLoading: machineId !== undefined && result === undefined,
  };
}
