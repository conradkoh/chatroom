'use client';

import { useMemo } from 'react';

import type { HarnessOption } from './useHarnessConfig';
import { useMachineModelFilter } from '../../components/model-selection';
import {
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
  const harnesses = useMemo(
    () => resolveNativeHarnessOptions(capabilities?.harnesses ?? []),
    [capabilities?.harnesses]
  );
  const machineId = capabilities?.machineId ?? null;

  const resolvedHarnessName = useMemo(
    () => resolveSelectedHarnessName(harnesses, harnessName),
    [harnessName, harnesses]
  );

  const filter = useMachineModelFilter(machineId, resolvedHarnessName);

  return { harnesses, machineId, resolvedHarnessName, filter };
}
