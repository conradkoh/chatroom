'use client';

import type { Id } from '@workspace/backend/convex/_generated/dataModel';
import { getPermanentRoleNames } from '@workspace/shared/domain/agent-role';
import { Loader2, Play } from 'lucide-react';
import { memo, useCallback, useEffect, useMemo, useState } from 'react';

import type { AgentRoleView } from '../../hooks/useAgentPanelData';
import type {
  MachineInfo,
  AgentConfig,
  SendCommandFn,
  AgentHarness,
  CodexMaxReasoningLevel,
} from '../../types/machine';
import { getMachineDisplayName } from '../../types/machine';
import { getFailedAgentRoles } from '../../utils/agentBulkStart';
import { startAgentsBatch } from '../../utils/agentStart';
import { countJoinedRoles } from '../../utils/countJoinedRoles';
import { InlineAgentCard } from '../AgentPanel/InlineAgentCard';

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
  connectedMachines: MachineInfo[];
  isLoadingMachines: boolean;
  agentConfigs: AgentConfig[];
  sendCommand: SendCommandFn;
  agentRoleViews: AgentRoleView[];
  onAllAgentsStarted: () => void;
  onBack: () => void;
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
  connectedMachines,
  isLoadingMachines,
  agentConfigs,
  sendCommand,
  agentRoleViews,
  onAllAgentsStarted,
  onBack,
}: SetupAgentTeamStepProps) {
  const [isStartingAll, setIsStartingAll] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);
  const [roleConfigs, setRoleConfigs] = useState<
    Map<
      string,
      { harness: AgentHarness; model: string; maxReasoningLevel?: CodexMaxReasoningLevel }
    >
  >(() => new Map());

  const machine = useMemo(
    () => connectedMachines.find((m) => m.machineId === machineId) ?? null,
    [connectedMachines, machineId]
  );

  const persistentTeamRoles = useMemo(() => getPermanentRoleNames(teamRoles), [teamRoles]);

  const joinedCount = useMemo(
    () => countJoinedRoles(persistentTeamRoles, participants),
    [persistentTeamRoles, participants]
  );

  const allJoined = joinedCount === persistentTeamRoles.length && persistentTeamRoles.length > 0;

  useEffect(() => {
    if (allJoined) onAllAgentsStarted();
  }, [allJoined, onAllAgentsStarted]);

  const handleSetupConfigChange = useCallback(
    (
      role: string,
      harness: AgentHarness | null,
      model: string | null,
      maxReasoningLevel?: CodexMaxReasoningLevel
    ) => {
      if (!harness || !model) return;
      const storedCap = harness === 'codex-sdk' ? maxReasoningLevel : undefined;
      const key = role.toLowerCase();
      setRoleConfigs((prev) => {
        const existing = prev.get(key);
        if (
          existing?.harness === harness &&
          existing?.model === model &&
          existing?.maxReasoningLevel === storedCap
        ) {
          return prev;
        }
        const next = new Map(prev);
        next.set(key, { harness, model, maxReasoningLevel: storedCap });
        return next;
      });
    },
    []
  );

  const agentRoleViewMap = useMemo(
    () => new Map(agentRoleViews.map((a) => [a.role.toLowerCase(), a])),
    [agentRoleViews]
  );

  const handleStartAll = useCallback(async () => {
    const missing = persistentTeamRoles.filter((role) => !roleConfigs.has(role.toLowerCase()));
    if (missing.length > 0) {
      setStartError(`Select harness and model for: ${missing.join(', ')}`);
      return;
    }

    setIsStartingAll(true);
    setStartError(null);
    const chatroomIdTyped = chatroomId as Id<'chatroom_rooms'>;

    const results = await startAgentsBatch(
      persistentTeamRoles,
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
          ...(config.harness === 'codex-sdk' && config.maxReasoningLevel !== undefined
            ? { maxReasoningLevel: config.maxReasoningLevel }
            : {}),
        };
      },
      sendCommand
    );

    setIsStartingAll(false);
    const failed = getFailedAgentRoles(results, persistentTeamRoles);
    if (failed.length > 0) {
      setStartError(`Failed to start: ${failed.join(', ')}`);
    }
  }, [
    persistentTeamRoles,
    roleConfigs,
    agentRoleViewMap,
    sendCommand,
    machineId,
    workingDir,
    chatroomId,
  ]);

  return (
    <div className="max-w-2xl mx-auto p-6 space-y-6">
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
        <button
          type="button"
          onClick={onBack}
          disabled={isStartingAll}
          className="text-[10px] font-bold uppercase tracking-widest text-chatroom-accent hover:text-chatroom-text-primary disabled:opacity-50"
        >
          Change
        </button>
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
        <div className="border border-chatroom-border">
          {persistentTeamRoles.map((role) => {
            const participant = participants.find(
              (p) => p.role.toLowerCase() === role.toLowerCase()
            );
            return (
              <InlineAgentCard
                key={role}
                role={role}
                allRoles={persistentTeamRoles}
                lastSeenAt={participant?.lastSeenAt ?? null}
                statusLabel="OFFLINE"
                statusVariant="offline"
                prompt=""
                chatroomId={chatroomId}
                teamId={teamId}
                connectedMachines={connectedMachines}
                isLoadingMachines={isLoadingMachines}
                agentConfigs={agentConfigs}
                sendCommand={sendCommand}
                agentRoleView={agentRoleViewMap.get(role.toLowerCase())}
                setupMode
                lockedMachineId={machineId}
                lockedWorkingDir={workingDir}
                onSetupConfigChange={(harness, model, maxReasoningLevel) =>
                  handleSetupConfigChange(role, harness, model, maxReasoningLevel)
                }
              />
            );
          })}
        </div>
      </div>

      {startError && <p className="text-xs text-chatroom-status-error">{startError}</p>}

      {!allJoined && (
        <div className="flex justify-end pt-2">
          <button
            type="button"
            onClick={() => void handleStartAll()}
            disabled={isStartingAll || isLoadingMachines}
            className="flex items-center gap-2 px-4 py-2 bg-chatroom-status-success text-chatroom-bg-primary text-xs font-bold uppercase tracking-wider hover:opacity-90 disabled:opacity-50"
          >
            {isStartingAll ? <Loader2 size={14} className="animate-spin" /> : <Play size={14} />}
            Start Agents
          </button>
        </div>
      )}

      {allJoined && (
        <div className="flex flex-col items-center justify-center gap-3 py-6 text-center">
          <p className="text-sm font-bold uppercase tracking-widest text-chatroom-status-success">
            All Agents Ready
          </p>
          <p className="text-xs text-chatroom-text-muted">Closing setup...</p>
        </div>
      )}
    </div>
  );
});
