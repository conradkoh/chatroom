'use client';

import { api } from '@workspace/backend/convex/_generated/api';
import { useSessionQuery } from 'convex-helpers/react/sessions';
import { useMemo } from 'react';

import type { HarnessOption } from './useHarnessConfig';
import { useMachineModelFilter } from '../../components/model-selection';
import {
  applyHarnessVersions,
  resolveNativeHarnessOptions,
  resolveSelectedHarnessName,
} from '../utils/harness-selection';

export interface NativeHarnessWorkspaceCapabilities {
  machineId: string | null;
  harnesses: HarnessOption[];
}

export function useNativeHarnessWorkspace(
  capabilities: NativeHarnessWorkspaceCapabilities | null | undefined,
  harnessName: string
) {
  const machinesResult = useSessionQuery(api.machines.listMachines, {});
  const machineId = capabilities?.machineId ?? null;

  const harnessVersions = useMemo(() => {
    if (!machineId) return undefined;
    const machine = machinesResult?.machines?.find(
      (m: { machineId: string }) => m.machineId === machineId
    );
    return machine?.harnessVersions;
  }, [machineId, machinesResult?.machines]);

  const harnesses = useMemo(
    () =>
      applyHarnessVersions(
        resolveNativeHarnessOptions(capabilities?.harnesses ?? []),
        harnessVersions
      ),
    [capabilities?.harnesses, harnessVersions]
  );

  const resolvedHarnessName = useMemo(
    () => resolveSelectedHarnessName(harnesses, harnessName),
    [harnessName, harnesses]
  );

  const filter = useMachineModelFilter(machineId, resolvedHarnessName);

  return { harnesses, machineId, resolvedHarnessName, filter };
}
