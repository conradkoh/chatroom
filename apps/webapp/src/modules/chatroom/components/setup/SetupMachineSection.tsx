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
  /** Offline machines are labelled and stay selectable. Used by the switch flow, where the backend does not need the target online. */
  offlineSelectable?: boolean;
}

/**
 * The machine picker for a setup step. While no machine is connected it also shows the
 * prerequisites, with the commands to fix them.
 */
// fallow-ignore-next-line complexity
export function SetupMachineSection({
  machines,
  connectedMachineIds,
  selectedMachineId,
  onSelectMachine,
  detectedHarnesses,
  offlineSelectable = false,
}: SetupMachineSectionProps) {
  const hasConnectedMachine = connectedMachineIds.size > 0;
  const offlineMachineIds = useMemo(
    () =>
      new Set(
        machines.filter((m) => !connectedMachineIds.has(m.machineId)).map((m) => m.machineId)
      ),
    [machines, connectedMachineIds]
  );
  // In offlineSelectable mode the prerequisites panel appears only when no machine is registered.
  const showPrerequisites = offlineSelectable ? machines.length === 0 : !hasConnectedMachine;

  return (
    <>
      {showPrerequisites && (
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
          {...(offlineSelectable
            ? { offlineMachineIds }
            : { disabledMachineIds: offlineMachineIds })}
        />
      )}
    </>
  );
}
