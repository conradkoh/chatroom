'use client';

/**
 * useHarnessModelFilter — per-machine, per-harness model visibility filter.
 *
 * Wraps the existing Convex getMachineModelFilters / upsertMachineModelFilters
 * mutations and the isModelHidden helper from modelSelection.ts.
 *
 * Designed to be callable from any direct-harness surface (NewSessionComposer
 * today; SessionComposer when in-session agent/model switching ships) — just
 * pass the machineId and harnessName from the capabilities payload.
 */

import { api } from '@workspace/backend/convex/_generated/api';
import { useSessionMutation, useSessionQuery } from 'convex-helpers/react/sessions';
import { useCallback } from 'react';

import { isModelHidden } from '../../utils/modelSelection';

// ─── Types ────────────────────────────────────────────────────────────────────

/** Shape of a persisted filter from Convex (matches chatroom_machineModelFilters). */
export interface HarnessModelFilter {
  hiddenModels: string[];
  hiddenProviders: string[];
}

export interface UseHarnessModelFilterResult {
  /** Current filter doc, or null when unconfigured / undefined when loading. */
  filter: HarnessModelFilter | null | undefined;
  /** Persist a new filter state. No-op when !enabled. */
  setFilter: (hiddenModels: string[], hiddenProviders: string[]) => Promise<void>;
  /**
   * Returns true if the model would be hidden under the current filter.
   * Accepts both `"<providerID>/<modelID>"` and `"<providerID>::<modelID>"` key formats.
   */
  isHidden: (modelKeyOrId: string) => boolean;
  /** True when both machineId and harnessName are present (persistence is available). */
  enabled: boolean;
}

// ─── agentHarness validator union (mirrors schema.ts:5) ───────────────────────

type AgentHarness = 'opencode' | 'opencode-sdk' | 'pi' | 'cursor' | 'claude' | 'copilot';

// ─── Hook ─────────────────────────────────────────────────────────────────────

/**
 * Per-machine, per-harness model visibility filter.
 *
 * @param machineId  The machineId from capabilities.listForWorkspace (string | null | undefined).
 * @param harnessName  The harnessName emitted by the harness (e.g. 'opencode-sdk').
 */
export function useHarnessModelFilter(
  machineId: string | null | undefined,
  harnessName: string | null | undefined
): UseHarnessModelFilterResult {
  const enabled = Boolean(machineId && harnessName);

  const filterDoc = useSessionQuery(
    api.machines.getMachineModelFilters,
    enabled && machineId && harnessName
      ? { machineId, agentHarness: harnessName as AgentHarness }
      : 'skip'
  ) as HarnessModelFilter | null | undefined;

  const upsertMachineModelFilters = useSessionMutation(api.machines.upsertMachineModelFilters);

  const setFilter = useCallback(
    async (hiddenModels: string[], hiddenProviders: string[]) => {
      if (!enabled || !machineId || !harnessName) return;
      await upsertMachineModelFilters({
        machineId,
        agentHarness: harnessName as AgentHarness,
        hiddenModels,
        hiddenProviders,
      });
    },
    [enabled, machineId, harnessName, upsertMachineModelFilters]
  );

  const isHidden = useCallback(
    (modelKeyOrId: string): boolean => {
      // Normalize '::' separator (direct-harness format) to '/' (isModelHidden format)
      const normalized = modelKeyOrId.replace('::', '/');
      return isModelHidden(normalized, filterDoc ?? null);
    },
    [filterDoc]
  );

  return { filter: filterDoc, setFilter, isHidden, enabled };
}
