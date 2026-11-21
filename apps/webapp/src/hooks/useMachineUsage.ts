/**
 * useMachineUsage — owner-facing active workspace/chatroom counts per machine.
 *
 * Single thin subscription over `machines.getMachineUsage`. Entries are absent
 * until the query resolves; callers render a skeleton for missing entries.
 */

'use client';

import { api } from '@workspace/backend/convex/_generated/api';
import type { MachineUsage } from '@workspace/backend/src/domain/usecase/machine/machine-usage';
import { useSessionQuery } from 'convex-helpers/react/sessions';
import { useMemo } from 'react';

export type { MachineUsage };

/** machineId → usage. Empty Map until the query resolves. */
export function useMachineUsage(): Map<string, MachineUsage> {
  const result = useSessionQuery(api.machines.getMachineUsage);

  return useMemo(
    () => new Map((result?.machines ?? []).map(({ machineId, ...usage }) => [machineId, usage])),
    [result]
  );
}
