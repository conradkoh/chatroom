'use client';

import React, { memo, useState, useMemo } from 'react';

import { api } from '@workspace/backend/convex/_generated/api';
import type { Id } from '@workspace/backend/convex/_generated/dataModel';
import type { AgentRoleView } from '@workspace/backend/src/domain/usecase/agent/get-agent-status-for-chatroom';
import { useSessionQuery } from 'convex-helpers/react/sessions';

import type { MachineInfo, AgentConfig, SendCommandFn } from '../../types/machine';
import { useAgentControls, RemoteTabContent, CustomTabContent } from '../AgentConfigTabs';
import type { AgentPreference } from '../AgentConfigTabs';
import { AgentStatusRow } from './AgentStatusRow';
import { AgentRestartStatsModal } from './AgentRestartStatsModal';
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

// ─── InlineAgentCard ─────────────────────────────────────────────────────────

export interface InlineAgentCardProps {
  role: string;
  online: boolean;
  lastSeenAt?: number | null;
  latestEventType?: string | null;
  prompt: string;
  chatroomId: string;
  connectedMachines: MachineInfo[];
  isLoadingMachines: boolean;
  agentConfigs: AgentConfig[];
  sendCommand: SendCommandFn;
  agentRoleView?: AgentRoleView;
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
  prompt,
  chatroomId,
  connectedMachines,
  isLoadingMachines,
  agentConfigs,
  sendCommand,
  agentRoleView,
  agentPreference,
  onSavePreference,
}: InlineAgentCardProps) {
  const [activeTab, setActiveTab] = useState<'remote' | 'custom'>(
    agentRoleView?.type === 'custom' ? 'custom' : 'remote'
  );

  const controls = useAgentControls({
    role,
    chatroomId,
    connectedMachines,
    agentConfigs,
    sendCommand,
    teamConfigModel: agentRoleView?.model,
    teamConfigHarness: agentRoleView?.agentHarness,
    agentPreference,
    onSavePreference,
  });

  const daemonStartCommand = getDaemonStartCommand();
  const statusLabel = online ? eventTypeToStatusLabel(latestEventType) : 'OFFLINE';

  // Resolve machineId from agentConfigs for restart stats query
  const statsMachineId = useMemo(() => {
    const config = agentConfigs.find((c) => c.role.toLowerCase() === role.toLowerCase());
    return config?.machineId ?? null;
  }, [agentConfigs, role]);

  const [statsOpen, setStatsOpen] = useState(false);

  const restartSummary = useSessionQuery(
    api.machines.getAgentRestartSummary,
    statsMachineId
      ? {
          machineId: statsMachineId,
          role,
          chatroomId: chatroomId as Id<'chatroom_rooms'>,
        }
      : 'skip'
  );

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
          />
        </div>

        {/* Tab bar — closer to content below */}
        <div className="flex gap-3 mb-1">
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
        <div className="pt-2">
          {activeTab === 'remote' ? (
            <RemoteTabContent
              controls={controls}
              connectedMachines={connectedMachines}
              isLoadingMachines={isLoadingMachines}
              daemonStartCommand={daemonStartCommand}
            />
          ) : (
            <CustomTabContent role={role} prompt={prompt} />
          )}
        </div>

        {/* Restart stats row — shown when machineId is known */}
        {statsMachineId && restartSummary && (
          <>
            <div className="mt-2 pt-2 border-t border-chatroom-border flex items-center gap-2">
              <span className="text-[9px] font-bold uppercase tracking-widest text-chatroom-text-muted flex-shrink-0">
                Restarts
              </span>
              <span className="text-[10px] text-chatroom-text-secondary">
                <span className="font-bold text-chatroom-text-primary">{restartSummary.count1h}</span>
                <span className="text-chatroom-text-muted"> in 1h</span>
                <span className="mx-1.5 text-chatroom-border-strong">·</span>
                <span className="font-bold text-chatroom-text-primary">{restartSummary.count24h}</span>
                <span className="text-chatroom-text-muted"> in 24h</span>
              </span>
              <button
                type="button"
                onClick={() => setStatsOpen(true)}
                className="ml-auto text-[9px] font-bold uppercase tracking-widest text-chatroom-accent hover:text-chatroom-text-primary transition-colors flex-shrink-0"
              >
                View Stats →
              </button>
            </div>

            <AgentRestartStatsModal
              isOpen={statsOpen}
              onClose={() => setStatsOpen(false)}
              role={role}
              machineId={statsMachineId}
              workingDir={agentRoleView?.workingDir ?? ''}
              chatroomId={chatroomId}
            />
          </>
        )}
      </div>
    </div>
  );
});
