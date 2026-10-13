'use client';

import type { Id } from '@workspace/backend/convex/_generated/dataModel';
import { getPermanentRoleNames, isEphemeralAgentRole } from '@workspace/shared/domain/agent-role';
import { Loader2, Play } from 'lucide-react';
import { memo, useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';

import { SetupStepFooter, SetupStepLayout, setupPrimaryButtonClassName } from './SetupStepLayout';
import { SetupWorkspaceLoadingPanel } from './SetupWorkspaceLoadingPanel';
import type {
  MachineInfo,
  UserMachine,
  AgentConfig,
  SendCommandFn,
  AgentHarness,
} from '../../types/machine';
import { getMachineDisplayName } from '../../types/machine';
import { getFailedAgentRoles } from '../../utils/agentBulkStart';
import { startAgentsBatch } from '../../utils/agentStart';
import { countJoinedRoles } from '../../utils/countJoinedRoles';
import { AgentControlDataProvider } from '../AgentPanel/AgentControlDataContext';
import { InlineAgentCard } from '../AgentPanel/InlineAgentCard';

import { useMachineCapabilities } from '@/hooks/useMachineCapabilities';

interface Participant {
  role: string;
  lastSeenAt?: number | null;
}

interface SetupAgentTeamStepProps {
  chatroomId: string;
  teamId?: string;
  teamRoles: string[];
  teamEntryPoint?: string;
  participants: Participant[];
  machineId: string;
  workingDir: string;
  machines: UserMachine[];
  isLoadingMachines: boolean;
  agentConfigs: AgentConfig[];
  sendCommand: SendCommandFn;
  onAllAgentsStarted: () => void;
  /** Omit when the step cannot go back (for example, the chatroom already exists). */
  onBack?: () => void;
  /** Called after every agent in the batch started without error. */
  onStartRequested?: () => void;
  /** Rendered first in the body, above the workspace card. */
  bodyStart?: ReactNode;
  /** Left side of the footer, for example "Open chatroom". */
  footerSecondary?: ReactNode;
  /** Passed to the layout. True focuses the first control on mount. */
  autoFocusFirstControl: boolean;
}

// fallow-ignore-next-line complexity
export const SetupAgentTeamStep = memo(function SetupAgentTeamStep({
  chatroomId,
  teamId,
  teamRoles,
  teamEntryPoint: _teamEntryPoint,
  participants,
  machineId,
  workingDir,
  machines,
  isLoadingMachines,
  agentConfigs,
  sendCommand,
  onAllAgentsStarted,
  onBack,
  onStartRequested,
  bodyStart,
  footerSecondary,
  autoFocusFirstControl,
}: SetupAgentTeamStepProps) {
  const [isStartingAll, setIsStartingAll] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);
  const [roleConfigs, setRoleConfigs] = useState<
    Map<string, { harness: AgentHarness; model: string }>
  >(() => new Map());

  // Harnesses are only known once the machine's capabilities load. Cards wait for them, so the
  // favourite default and the initial selection never run against an empty harness list.
  const {
    availableHarnesses,
    harnessVersions,
    isLoading: harnessesLoading,
  } = useMachineCapabilities(machineId);
  const lockedMachine = useMemo<MachineInfo | null>(() => {
    const base = machines.find((m) => m.machineId === machineId);
    if (!base) return null;
    return { ...base, availableHarnesses, harnessVersions };
  }, [machines, machineId, availableHarnesses, harnessVersions]);

  const machine = lockedMachine;

  // Readiness (joinedCount, allJoined, the Start gate) is computed from permanent roles only.
  // Ephemeral roles get cards and start when configured, but never block the wizard.
  // `user` is not a team agent. getPermanentRoleNames would treat an unknown name as permanent,
  // so it is excluded explicitly. Retired roles are already dropped by getPermanentRoleNames,
  // and isEphemeralAgentRole is false for both `user` and retired names.
  const persistentTeamRoles = useMemo(
    () => getPermanentRoleNames(teamRoles).filter((role) => role !== 'user'),
    [teamRoles]
  );
  const ephemeralTeamRoles = useMemo(
    () => teamRoles.filter((role) => isEphemeralAgentRole(role)),
    [teamRoles]
  );
  // Permanent cards first, then ephemeral cards (mirrors AgentPanel).
  const rolesToShow = useMemo(
    () => [...persistentTeamRoles, ...ephemeralTeamRoles],
    [persistentTeamRoles, ephemeralTeamRoles]
  );

  const joinedCount = useMemo(
    () => countJoinedRoles(persistentTeamRoles, participants),
    [persistentTeamRoles, participants]
  );

  const allJoined = joinedCount === persistentTeamRoles.length && persistentTeamRoles.length > 0;

  useEffect(() => {
    if (allJoined) onAllAgentsStarted();
  }, [allJoined, onAllAgentsStarted]);

  const handleSetupConfigChange = useCallback(
    (role: string, harness: AgentHarness | null, model: string | null) => {
      if (!harness || !model) return;
      setRoleConfigs((prev) => {
        const key = role.toLowerCase();
        const existing = prev.get(key);
        if (existing?.harness === harness && existing?.model === model) {
          return prev;
        }
        const next = new Map(prev);
        next.set(key, { harness, model });
        return next;
      });
    },
    []
  );

  const handleStartAll = useCallback(async () => {
    const missing = persistentTeamRoles.filter((role) => !roleConfigs.has(role.toLowerCase()));
    if (missing.length > 0) {
      setStartError(`Select harness and model for: ${missing.join(', ')}`);
      return;
    }

    // Ephemeral roles start only when configured. An unconfigured ephemeral role is skipped.
    // Permanent roles are all configured at this point, so the filter keeps every one of them.
    const rolesToStart = rolesToShow.filter((role) => roleConfigs.has(role.toLowerCase()));

    setIsStartingAll(true);
    setStartError(null);
    const chatroomIdTyped = chatroomId as Id<'chatroom_rooms'>;

    const results = await startAgentsBatch(
      rolesToStart,
      (role) => {
        const config = roleConfigs.get(role.toLowerCase());
        if (!config) return null;
        return {
          machineId,
          chatroomId: chatroomIdTyped,
          role,
          model: config.model,
          agentHarness: config.harness,
          workingDir,
        };
      },
      sendCommand
    );

    setIsStartingAll(false);
    const failed = getFailedAgentRoles(results, rolesToStart);
    if (failed.length > 0) {
      setStartError(`Failed to start: ${failed.join(', ')}`);
      return;
    }
    onStartRequested?.();
  }, [
    persistentTeamRoles,
    rolesToShow,
    roleConfigs,
    sendCommand,
    machineId,
    workingDir,
    chatroomId,
    onStartRequested,
  ]);

  const startButton = !allJoined ? (
    <button
      type="button"
      onClick={() => void handleStartAll()}
      disabled={isStartingAll || isLoadingMachines || harnessesLoading}
      className={setupPrimaryButtonClassName}
    >
      {isStartingAll ? <Loader2 size={14} className="animate-spin" /> : <Play size={14} />}
      Start Agents
    </button>
  ) : undefined;
  const footer =
    footerSecondary || !allJoined ? (
      <SetupStepFooter secondary={footerSecondary} primary={startButton} />
    ) : undefined;

  return (
    <SetupStepLayout autoFocusFirstControl={autoFocusFirstControl} footer={footer}>
      {bodyStart}
      <div className="flex items-start justify-between gap-4 p-4 border border-chatroom-border bg-chatroom-bg-surface">
        <div className="min-w-0 space-y-1">
          <p className="text-[10px] font-bold uppercase tracking-widest text-chatroom-text-muted">
            Workspace
          </p>
          <p className="text-sm font-medium text-chatroom-text-primary truncate">
            {machine ? getMachineDisplayName(machine) : machineId}
          </p>
          <p className="text-xs font-mono text-chatroom-text-secondary truncate">{workingDir}</p>
        </div>
        {onBack && (
          <button
            type="button"
            onClick={onBack}
            disabled={isStartingAll}
            className="text-[10px] font-bold uppercase tracking-widest text-chatroom-accent hover:text-chatroom-text-primary disabled:opacity-50"
          >
            Change
          </button>
        )}
      </div>

      <div>
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-xs font-bold uppercase tracking-widest text-chatroom-text-muted">
            Agents
          </h3>
          <span className="text-xs text-chatroom-text-muted">
            {joinedCount} of {persistentTeamRoles.length} ready
          </span>
        </div>
        <AgentControlDataProvider
          value={{
            machines: lockedMachine ? [lockedMachine] : [],
            daemonConnectivity: new Map(),
            isLoadingMachines,
            agentConfigs,
            sendCommand,
          }}
        >
          <div className="border border-chatroom-border">
            {harnessesLoading ? (
              <SetupWorkspaceLoadingPanel label="Loading agent harnesses..." />
            ) : (
              rolesToShow.map((role) => {
                const participant = participants.find(
                  (p) => p.role.toLowerCase() === role.toLowerCase()
                );
                return (
                  <InlineAgentCard
                    key={role}
                    role={role}
                    // The restart stats modal selects the tab by this card's own role, so every
                    // rendered role must be listed here (matches AgentPanel's rolesToShow).
                    allRoles={rolesToShow}
                    lastSeenAt={participant?.lastSeenAt ?? null}
                    statusLabel="OFFLINE"
                    statusVariant="offline"
                    prompt=""
                    chatroomId={chatroomId}
                    teamId={teamId}
                    setupMode
                    lockedMachineId={machineId}
                    lockedWorkingDir={workingDir}
                    harnessesLoading={harnessesLoading}
                    onSetupConfigChange={(harness, model) =>
                      handleSetupConfigChange(role, harness, model)
                    }
                  />
                );
              })
            )}
          </div>
        </AgentControlDataProvider>
      </div>

      {startError && <p className="text-xs text-chatroom-status-error">{startError}</p>}

      {allJoined && (
        <div className="flex flex-col items-center justify-center gap-3 py-6 text-center">
          <p className="text-sm font-bold uppercase tracking-widest text-chatroom-status-success">
            All Agents Ready
          </p>
          <p className="text-xs text-chatroom-text-muted">Closing setup...</p>
        </div>
      )}
    </SetupStepLayout>
  );
});
