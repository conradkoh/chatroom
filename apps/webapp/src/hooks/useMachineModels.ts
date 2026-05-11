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
import { useSessionQuery } from 'convex-helpers/react/sessions';

/**
 * Returns the available models record for a given machine, keyed by harness name.
 *
 * @param machineId - The machine UUID to query, or undefined when no machine is selected
 * @returns Record of harness → model IDs (e.g. `{ opencode: ['provider/claude-4'], pi: [...] }`)
 *
 * @example
 * ```tsx
 * const machineModels = useMachineModels(machine?.machineId);
 * const modelsForHarness = machineModels[selectedHarness] ?? [];
 * ```
 */
export function useMachineModels(machineId: string | undefined): Record<string, string[]> {
  const result = useSessionQuery(
    api.machines.getMachineModels,
    machineId ? { machineId } : 'skip',
  );
  return result?.availableModels ?? {};
}
