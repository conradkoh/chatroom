'use client';

import { useMemo } from 'react';

import { SetupMachinePicker } from './SetupMachinePicker';
import { SetupWorkspacePrerequisitesPanel } from './SetupWorkspacePrerequisitesPanel';
import type { AgentHarness, UserMachine } from '../../types/machine';

import { getAuthLoginCommandForCurrentOrigin, getDaemonStartCommand } from '@/lib/environment';

export interface SetupMachineSectionProps {
  /** Machines to list. Any machine not in connectedMachineIds is listed but cannot be picked. */
  machines: UserMachine[];
  connectedMachineIds: ReadonlySet<string>;
  selectedMachineId: string | null;
  onSelectMachine: (machineId: string) => void;
  detectedHarnesses: AgentHarness[];
}

/**
 * The machine picker for a setup step. While no machine is connected it also shows the
 * prerequisites, with the commands to fix them.
 */
export function SetupMachineSection({
  machines,
  connectedMachineIds,
  selectedMachineId,
  onSelectMachine,
  detectedHarnesses,
}: SetupMachineSectionProps) {
  const hasConnectedMachine = connectedMachineIds.size > 0;
  const offlineMachineIds = useMemo(
    () =>
      new Set(
        machines.filter((m) => !connectedMachineIds.has(m.machineId)).map((m) => m.machineId)
      ),
    [machines, connectedMachineIds]
  );

  return (
    <>
      {!hasConnectedMachine && (
        <SetupWorkspacePrerequisitesPanel
          daemonDone={false}
          harnessDone={detectedHarnesses.length > 0}
          detectedHarnesses={detectedHarnesses}
          authLoginCommand={getAuthLoginCommandForCurrentOrigin()}
          daemonStartCommand={getDaemonStartCommand()}
        />
      )}

      {machines.length === 0 ? (
        <p className="text-xs text-chatroom-text-muted">
          No machines are registered yet. Start the daemon on a machine to see it here.
        </p>
      ) : (
        <SetupMachinePicker
          machines={machines}
          selectedMachineId={selectedMachineId}
          onSelectMachine={onSelectMachine}
          disabledMachineIds={offlineMachineIds}
        />
      )}
    </>
  );
}
