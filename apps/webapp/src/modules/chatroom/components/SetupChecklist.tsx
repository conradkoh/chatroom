'use client';

import { api } from '@workspace/backend/convex/_generated/api';
import type { Id } from '@workspace/backend/convex/_generated/dataModel';
import { useSessionMutation, useSessionQuery } from 'convex-helpers/react/sessions';
import { Rocket, Check, Terminal } from 'lucide-react';
import React, { useMemo, useCallback, memo } from 'react';

import {
  useAgentControls,
  RemoteTabContent,
  AgentStatusBanner,
} from './AgentConfigTabs';
import { CopyButton } from './CopyButton';
import type { MachineInfo, AgentConfig, SendCommandFn } from '../types/machine';

import { getDaemonStartCommand, getAuthLoginCommand, isLocalEnvironment } from '@/lib/environment';
import { usePrompts } from '@/contexts/PromptsContext';

// ─── Types ──────────────────────────────────────────────────────────

interface Participant {
  role: string;
  lastSeenAt?: number | null;
}

interface SetupChecklistProps {
  chatroomId: string;
  teamName: string;
  teamRoles: string[];
  teamEntryPoint?: string;
  participants: Participant[];
  onViewPrompt: (role: string) => void;
  /** Hide the header section (used when rendered inside a modal with its own header) */
  hideHeader?: boolean;
}

// ─── State machine ──────────────────────────────────────────────────

type SetupState = 'no-machines' | 'offline-machines' | 'ready-to-start' | 'joined';

function deriveSetupState({
  isJoined,
  connectedMachines,
  allMachines,
}: {
  isJoined: boolean;
  connectedMachines: MachineInfo[];
  allMachines: MachineInfo[];
}): SetupState {
  if (isJoined) return 'joined';
  if (connectedMachines.length > 0) return 'ready-to-start';
  if (allMachines.length > 0) return 'offline-machines';
  return 'no-machines';
}

// ─── RunManuallySection ─────────────────────────────────────────────

function RunManuallySection({
  role,
  onViewPrompt,
}: {
  role: string;
  prompt: string;
  onViewPrompt: (role: string) => void;
}) {
  return (
    <button
      onClick={() => onViewPrompt(role)}
      className="text-xs text-chatroom-text-muted hover:text-chatroom-text-secondary underline underline-offset-2 transition-colors"
    >
      → Run manually instead
    </button>
  );
}

// ─── Setup Agent Card ───────────────────────────────────────────────

interface SetupAgentCardProps {
  role: string;
  index: number;
  isJoined: boolean;
  prompt: string;
  chatroomId: string;
  connectedMachines: MachineInfo[];
  allMachines: MachineInfo[];
  agentConfigs: AgentConfig[];
  isLoadingMachines: boolean;
  daemonStartCommand: string;
  sendCommand: SendCommandFn;
  onViewPrompt: (role: string) => void;
}

const SetupAgentCard = memo(function SetupAgentCard({
  role,
  index,
  isJoined,
  prompt,
  chatroomId,
  connectedMachines,
  allMachines,
  agentConfigs,
  isLoadingMachines,
  daemonStartCommand,
  sendCommand,
  onViewPrompt,
}: SetupAgentCardProps) {
  // Always call unconditionally (rules of hooks)
  const controls = useAgentControls({
    role,
    chatroomId,
    connectedMachines,
    agentConfigs,
    sendCommand,
  });

  const state = deriveSetupState({ isJoined, connectedMachines, allMachines });

  return (
    <div
      className={`bg-chatroom-bg-surface border-2 transition-all duration-100 ${
        isJoined
          ? 'border-chatroom-status-success/30 bg-chatroom-status-success/5'
          : 'border-chatroom-border hover:border-chatroom-border-strong'
      }`}
    >
      {/* Step Header */}
      <div className="flex justify-between items-center p-4">
        <div className="flex items-center gap-3">
          <span
            className={`w-6 h-6 flex items-center justify-center text-xs font-bold ${
              isJoined
                ? 'bg-chatroom-status-success text-chatroom-bg-primary'
                : 'bg-chatroom-bg-hover text-chatroom-text-muted'
            }`}
          >
            {isJoined ? <Check size={14} /> : index + 1}
          </span>
          <span className="text-sm font-bold uppercase tracking-wide text-chatroom-text-primary">
            {role}
          </span>
        </div>
        <span
          className={`px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${
            isJoined
              ? 'bg-chatroom-status-success/15 text-chatroom-status-success'
              : 'bg-chatroom-status-warning/15 text-chatroom-status-warning'
          }`}
        >
          {isJoined ? 'Ready' : 'Waiting'}
        </span>
      </div>

      {/* Card Content — driven by state machine */}
      {state === 'no-machines' && (
        <div className="px-4 pb-4 space-y-3">
          <p className="text-xs text-chatroom-text-muted">
            Run this on the machine you want to use as an agent host:
          </p>
          <div className="flex items-start gap-2 p-3 bg-chatroom-bg-primary">
            <pre className="font-mono text-xs text-chatroom-text-secondary flex-1 whitespace-pre-wrap">
              {daemonStartCommand}
            </pre>
            <CopyButton text={daemonStartCommand} label="Copy" copiedLabel="Copied!" variant="compact" />
          </div>
          <p className="text-xs text-chatroom-text-muted">
            The daemon connects your machine to this chatroom so agents can run on it.
          </p>
          <RunManuallySection role={role} prompt={prompt} onViewPrompt={onViewPrompt} />
        </div>
      )}

      {state === 'offline-machines' && (
        <div className="px-4 pb-4 space-y-3">
          <div className="space-y-1">
            {allMachines.map((m) => (
              <div key={m.machineId} className="flex items-center gap-2 text-xs text-chatroom-text-muted">
                <span className="w-1.5 h-1.5 bg-chatroom-text-muted opacity-40" />
                <span className="font-mono">{m.hostname ?? m.machineId}</span>
                <span className="text-chatroom-text-muted opacity-60">offline</span>
              </div>
            ))}
          </div>
          <p className="text-xs text-chatroom-text-muted">
            Run on one of your machines to reconnect:
          </p>
          <div className="flex items-start gap-2 p-3 bg-chatroom-bg-primary">
            <pre className="font-mono text-xs text-chatroom-text-secondary flex-1 whitespace-pre-wrap">
              {daemonStartCommand}
            </pre>
            <CopyButton text={daemonStartCommand} label="Copy" copiedLabel="Copied!" variant="compact" />
          </div>
          <RunManuallySection role={role} prompt={prompt} onViewPrompt={onViewPrompt} />
        </div>
      )}

      {state === 'ready-to-start' && (
        <div className="px-4 pb-4 space-y-3">
          <AgentStatusBanner controls={controls} />
          <RemoteTabContent
            controls={controls}
            connectedMachines={connectedMachines}
            isLoadingMachines={isLoadingMachines}
            daemonStartCommand={daemonStartCommand}
          />
          <RunManuallySection role={role} prompt={prompt} onViewPrompt={onViewPrompt} />
        </div>
      )}

      {/* state === 'joined': no card body — collapsed green header only */}
    </div>
  );
});

// ─── Main Component ─────────────────────────────────────────────────

export const SetupChecklist = memo(function SetupChecklist({
  chatroomId,
  teamName: _teamName,
  teamRoles,
  teamEntryPoint: _teamEntryPoint,
  participants,
  onViewPrompt,
  hideHeader = false,
}: SetupChecklistProps) {
  const { getAgentPrompt } = usePrompts();

  // ── Machine data ──────────────────────────────────────────────────
  const machinesResult = useSessionQuery(api.machines.listMachines, {}) as
    | { machines: MachineInfo[] }
    | undefined;

  const configsResult = useSessionQuery(api.machines.getAgentConfigs, {
    chatroomId: chatroomId as Id<'chatroom_rooms'>,
  }) as { configs: AgentConfig[] } | undefined;

  const sendCommand = useSessionMutation(api.machines.sendCommand);

  const allMachines = useMemo(() => {
    return machinesResult?.machines ?? [];
  }, [machinesResult?.machines]);

  const connectedMachines = useMemo(() => {
    return allMachines.filter((m) => m.daemonConnected);
  }, [allMachines]);

  const agentConfigs = useMemo(() => {
    return configsResult?.configs || [];
  }, [configsResult?.configs]);

  const isLoadingMachines = machinesResult === undefined || configsResult === undefined;

  const daemonStartCommand = getDaemonStartCommand();

  // ── Participants & prompts ────────────────────────────────────────

  const participantMap = useMemo(
    () => new Map(participants.map((p) => [p.role.toLowerCase(), p])),
    [participants]
  );

  const generatePrompt = useCallback(
    (role: string): string => {
      return getAgentPrompt(role) || '';
    },
    [getAgentPrompt]
  );

  const authLoginCommand = getAuthLoginCommand(window.location.origin);

  const joinedCount = useMemo(
    () =>
      teamRoles.filter((role) => {
        const p = participantMap.get(role.toLowerCase());
        return p != null && p.lastSeenAt != null;
      }).length,
    [teamRoles, participantMap]
  );

  return (
    <div className="max-w-2xl mx-auto p-6">
      {/* Header - hidden when used in modal */}
      {!hideHeader && (
        <div className="mb-6 pb-6 border-b-2 border-chatroom-border">
          <h2 className="flex items-center gap-2 text-lg font-bold uppercase tracking-widest text-chatroom-text-primary mb-2">
            <Rocket size={20} /> Setup Your Team
          </h2>
          <p className="text-sm text-chatroom-text-muted">
            {joinedCount} of {teamRoles.length} agents ready
          </p>
        </div>
      )}

      {/* Auth Login Section - shown for non-production */}
      {isLocalEnvironment() && (
        <div className="bg-chatroom-bg-surface border-2 border-chatroom-status-warning/30 mb-6">
          <div className="flex items-center gap-2 p-4 border-b border-chatroom-border">
            <Terminal size={16} className="text-chatroom-status-warning" />
            <span className="text-sm font-bold uppercase tracking-wide text-chatroom-text-primary">
              CLI Authentication
            </span>
            <span className="px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide bg-chatroom-status-warning/15 text-chatroom-status-warning">
              Local Mode
            </span>
          </div>
          <div className="p-4">
            <p className="text-xs text-chatroom-text-muted mb-3">
              Authenticate agents with this local backend:
            </p>
            <div className="flex items-start gap-2 p-3 bg-chatroom-bg-primary">
              <pre className="font-mono text-xs text-chatroom-text-secondary flex-1 whitespace-pre-wrap">
                {authLoginCommand}
              </pre>
              <CopyButton
                text={authLoginCommand}
                label="Copy"
                copiedLabel="Copied!"
                variant="compact"
              />
            </div>
          </div>
        </div>
      )}

      {/* Steps */}
      <div className="flex flex-col gap-4">
        {teamRoles.map((role, index) => {
          const participant = participantMap.get(role.toLowerCase());
          const isJoined = participant != null && participant.lastSeenAt != null;
          const prompt = generatePrompt(role);

          return (
            <SetupAgentCard
              key={role}
              role={role}
              index={index}
              isJoined={isJoined}
              prompt={prompt}
              chatroomId={chatroomId}
              connectedMachines={connectedMachines}
              allMachines={allMachines}
              agentConfigs={agentConfigs}
              isLoadingMachines={isLoadingMachines}
              daemonStartCommand={daemonStartCommand}
              sendCommand={sendCommand}
              onViewPrompt={onViewPrompt}
            />
          );
        })}
      </div>
    </div>
  );
});
