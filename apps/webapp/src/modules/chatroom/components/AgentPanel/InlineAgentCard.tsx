'use client';

import React, { memo, useState } from 'react';

import type { AgentHarness, MachineInfo, AgentConfig, SendCommandFn } from '../../types/machine';
import { useAgentControls, RemoteTabContent, CustomTabContent } from '../AgentConfigTabs';
import type { AgentPreference } from '../AgentConfigTabs';
import { AgentActionButtons } from './AgentActionButtons';
import { AgentStatusRow } from './AgentStatusRow';
import { getDaemonStartCommand } from '@/lib/environment';

// Re-export helpers that are still imported from this file elsewhere
export { formatLastSeen } from './AgentStatusRow';

// ─── Helper functions ────────────────────────────────────────────────────────

/** Maps a chatroom_eventStream event type to a human-readable status label. */
export function eventTypeToStatusLabel(eventType: string | null | undefined): string {
  switch (eventType) {
    case 'agent.registered':
      return 'REGISTERED';
    case 'agent.waiting':
      return 'WAITING';
    case 'agent.requestStart':
      return 'STARTING';
    case 'agent.started':
      return 'RUNNING';
    case 'agent.requestStop':
      return 'STOPPING';
    case 'agent.exited':
      return 'STOPPED';
    case 'task.acknowledged':
      return 'TASK RECEIVED';
    case 'task.activated':
      return 'ACTIVE';
    case 'task.inProgress':
      return 'IN PROGRESS';
    case 'task.completed':
      return 'COMPLETED';
    default:
      return 'ONLINE';
  }
}

/** Resolves machine hostname from connected machines by machineId. */
export function resolveMachineHostname(
  machineId: string | undefined,
  connectedMachines: MachineInfo[]
): string | undefined {
  if (!machineId) return undefined;
  const machine = connectedMachines.find((m) => m.machineId === machineId);
  return machine?.hostname;
}

// ─── Team agent config shape matching the backend response ───────────────────

export interface TeamAgentConfig {
  role: string;
  type: 'remote' | 'custom';
  machineId?: string;
  agentHarness?: AgentHarness;
  model?: string;
  workingDir?: string;
}

// ─── InlineAgentCard ─────────────────────────────────────────────────────────

export interface InlineAgentCardProps {
  role: string;
  online: boolean;
  lastSeenAt?: number | null;
  latestEventType?: string | null;
  isStuck?: boolean;
  prompt: string;
  chatroomId: string;
  connectedMachines: MachineInfo[];
  isLoadingMachines: boolean;
  agentConfigs: AgentConfig[];
  sendCommand: SendCommandFn;
  teamConfig?: TeamAgentConfig;
  /** User's saved preference for this role's remote agent config */
  agentPreference?: AgentPreference;
  /** Called when user starts an agent — persists preference to backend */
  onSavePreference?: (pref: AgentPreference) => void;
}

/** Compact always-visible agent row with tabs for inline remote config editing. */
export const InlineAgentCard = memo(function InlineAgentCard({
  role,
  online,
  lastSeenAt,
  latestEventType,
  isStuck,
  prompt,
  chatroomId,
  connectedMachines,
  isLoadingMachines,
  agentConfigs,
  sendCommand,
  teamConfig,
  agentPreference,
  onSavePreference,
}: InlineAgentCardProps) {
  const [activeTab, setActiveTab] = useState<'remote' | 'custom'>(
    teamConfig?.type === 'custom' ? 'custom' : 'remote'
  );

  const controls = useAgentControls({
    role,
    chatroomId,
    connectedMachines,
    agentConfigs,
    sendCommand,
    teamConfigModel: teamConfig?.model,
    teamConfigHarness: teamConfig?.agentHarness,
    agentPreference,
    onSavePreference,
  });

  const daemonStartCommand = getDaemonStartCommand();
  const statusLabel = online ? eventTypeToStatusLabel(latestEventType) : 'OFFLINE';

  return (
    <div className="border-b border-chatroom-border last:border-b-0 px-4 py-3 flex items-stretch gap-3">
      {/* Column 1: Agent details + tabs + tab content (stretches) */}
      <div className="flex flex-col min-w-0 flex-1">
        {/* Status row at top — extra breathing room below */}
        <div className="mb-2">
          <AgentStatusRow
            role={role}
            online={online}
            statusLabel={statusLabel}
            lastSeenAt={lastSeenAt}
            isStuck={isStuck}
          />
        </div>

        {/* Tab bar — closer to content below */}
        <div className="pl-[18px] flex gap-3 mb-1">
          <button
            onClick={() => setActiveTab('remote')}
            className={`text-[11px] font-bold uppercase tracking-wide border-b-2 pb-0.5 transition-colors ${
              activeTab === 'remote'
                ? 'border-chatroom-accent text-chatroom-text-primary'
                : 'border-transparent text-chatroom-text-muted hover:text-chatroom-text-secondary'
            }`}
          >
            Remote
          </button>
          <button
            onClick={() => setActiveTab('custom')}
            className={`text-[11px] font-bold uppercase tracking-wide border-b-2 pb-0.5 transition-colors ${
              activeTab === 'custom'
                ? 'border-chatroom-accent text-chatroom-text-primary'
                : 'border-transparent text-chatroom-text-muted hover:text-chatroom-text-secondary'
            }`}
          >
            Custom
          </button>
        </div>

        {/* Tab content — sits directly after tab bar */}
        {activeTab === 'remote' ? (
          <RemoteTabContent
            controls={controls}
            connectedMachines={connectedMachines}
            isLoadingMachines={isLoadingMachines}
            daemonStartCommand={daemonStartCommand}
            teamConfigHarness={teamConfig?.agentHarness}
          />
        ) : (
          <CustomTabContent role={role} prompt={prompt} />
        )}
      </div>

      {/* Column 2: Start/Stop button — anchored to top (only for remote agents) */}
      {teamConfig?.type === 'remote' && (
        <div className="flex items-start justify-center flex-shrink-0 pt-1">
          <AgentActionButtons
            canStart={Boolean(controls.canStart)}
            canStop={Boolean(controls.canStop)}
            isStarting={controls.isStarting}
            isStopping={controls.isStopping}
            onStart={controls.handleStartAgent}
            onStop={controls.handleStopAgent}
          />
        </div>
      )}
    </div>
  );
});
