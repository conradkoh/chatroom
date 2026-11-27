/**
 * Hook to fetch one machine's daemon-pushed harness capabilities
 * (availableHarnesses + harnessVersions) from the chatroom_machineCapabilities
 * read model — the per-machine companion to useMachineModels.
 *
 * `reported` gates `availableHarnesses`: when false, treat the list as unknown
 * rather than empty.
 *
 * Keep this hook tiny — single thin wrapper, one subscription per call site.
 * Do NOT add fixed-slot or multi-machine patterns here.
 */

'use client';

import { api } from '@workspace/backend/convex/_generated/api';
import type {
  AgentHarness,
  HarnessVersionInfo,
} from '@workspace/backend/src/domain/entities/agent';
import { useSessionQuery } from 'convex-helpers/react/sessions';

export interface UseMachineCapabilitiesResult {
  availableHarnesses: AgentHarness[];
  harnessVersions: Partial<Record<AgentHarness, HarnessVersionInfo>>;
  /**
   * True only when the machine has reported its harness list. False while loading, for a null
   * machine, and for an unknown or foreign machine. Callers must treat `availableHarnesses` as
   * unknown when this is false.
   */
  reported: boolean;
  isLoading: boolean;
}

/**
 * Returns daemon capabilities for a machine.
 *
 * @param machineId - The machine UUID to query, or null/undefined when unknown
 */
export function useMachineCapabilities(
  machineId: string | null | undefined
): UseMachineCapabilitiesResult {
  const result = useSessionQuery(
    api.machines.getMachineCapabilities,
    machineId ? { machineId } : 'skip'
  );
  return {
    availableHarnesses: result?.availableHarnesses ?? [],
    harnessVersions: result?.harnessVersions ?? {},
    reported: result?.reported ?? false,
    isLoading: machineId != null && result === undefined,
  };
}
