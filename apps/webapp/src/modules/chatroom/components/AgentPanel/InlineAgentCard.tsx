'use client';

import { api } from '@workspace/backend/convex/_generated/api';
import type { Id } from '@workspace/backend/convex/_generated/dataModel';
import type { AgentRoleView } from '@workspace/backend/src/domain/usecase/chatroom/get-agent-statuses';
import { useSessionQuery } from 'convex-helpers/react/sessions';
import React, { memo, useState, useMemo } from 'react';

import type { MachineInfo, AgentConfig, SendCommandFn } from '../../types/machine';
import { getCompactModelId, getMachineDisplayName } from '../../types/machine';
import { useAgentControls } from '../AgentControls';
import { AgentControlsSection } from './AgentControlsSection';
import { AgentRestartStatsModal } from './AgentRestartStatsModal';
import { AgentStatusRow, getLabelColorClass, formatLastSeen } from './AgentStatusRow';
import { resolveAgentStatus, type StatusVariant } from '../../utils/agentStatusLabel';
import { useChatroomWorkspaces } from '../../workspace/hooks/useChatroomWorkspaces';

import { getDaemonStartCommand } from '@/lib/environment';

// Re-export helpers that are still imported from this file elsewhere
export { formatLastSeen } from './AgentStatusRow';

// ─── Helper functions ────────────────────────────────────────────────────────

/** Resolves machine display name (alias or hostname) from connected machines by machineId. */
export function resolveMachineHostname(
  machineId: string | undefined,
  connectedMachines: MachineInfo[]
): string | undefined {
  if (!machineId) return undefined;
  const machine = connectedMachines.find((m) => m.machineId === machineId);
  return machine ? getMachineDisplayName(machine) : undefined;
}

// ─── InlineAgentCard ─────────────────────────────────────────────────────────

export interface InlineAgentCardProps {
  role: string;
  /** All agent roles in the workspace (for shared restart stats modal). */
  allRoles: string[];
  online: boolean;
  lastSeenAt?: number | null;
  latestEventType?: string | null;
  /** Desired lifecycle state from teamAgentConfigs (e.g. 'running' | 'stopped'). */
  desiredState?: string | null;
  /** Pre-resolved status variant; if provided, skips local resolveAgentStatus call. */
  statusVariant?: StatusVariant;
  prompt: string;
  chatroomId: string;
  connectedMachines: MachineInfo[];
  isLoadingMachines: boolean;
  agentConfigs: AgentConfig[];
  sendCommand: SendCommandFn;
  agentRoleView?: AgentRoleView;
  /** Pre-fetched restart summary from parent batch query.
   * When provided, InlineAgentCard skips its own per-card subscription.
   * Uses 3h/3d time ranges for consistency with AgentRestartChart (default 3d view).
   */
  restartSummary?: { count3h: number; count3d: number } | null;
}

interface AgentCardModelLineProps {
  model?: string | null;
}

const AgentCardModelLine = memo(function AgentCardModelLine({ model }: AgentCardModelLineProps) {
  if (!model) return null;
  return (
    <div className="mt-2 text-[10px] font-bold uppercase tracking-wide text-chatroom-text-muted truncate">
      {getCompactModelId(model)}
    </div>
  );
});

interface AgentCardStatusFooterProps {
  statusLabel: string;
  resolvedVariant: StatusVariant;
  online: boolean;
  lastSeenAt?: number | null;
}

const AgentCardStatusFooter = memo(function AgentCardStatusFooter({
  statusLabel,
  resolvedVariant,
  online,
  lastSeenAt,
}: AgentCardStatusFooterProps) {
  return (
    <div className="mt-2">
      <span
        className={
          'text-[10px] font-bold uppercase tracking-wide ' +
          getLabelColorClass(resolvedVariant, online)
        }
      >
        {statusLabel}
      </span>
      <span className="text-[10px] font-bold text-chatroom-text-muted mx-1.5">·</span>
      <span className="text-[10px] font-bold uppercase tracking-wide text-chatroom-text-muted">
        {formatLastSeen(lastSeenAt)}
      </span>
    </div>
  );
});

interface AgentCardRestartSectionProps {
  restartSummary: { count3h: number; count3d: number };
  statsMachineId: string | null;
  statsOpen: boolean;
  onOpenStats: () => void;
  onCloseStats: () => void;
  allRoles: string[];
  role: string;
  chatroomId: string;
  defaultModel?: string;
}

const AgentCardRestartSection = memo(function AgentCardRestartSection({
  restartSummary,
  statsMachineId,
  statsOpen,
  onOpenStats,
  onCloseStats,
  allRoles,
  role,
  chatroomId,
  defaultModel,
}: AgentCardRestartSectionProps) {
  return (
    <>
      <div className="mt-2 pt-2 border-t border-chatroom-border flex items-center gap-2">
        <span className="text-[9px] font-bold uppercase tracking-widest text-chatroom-text-muted flex-shrink-0">
          Restarts
        </span>
        <span className="text-[10px] text-chatroom-text-secondary">
          <span className="font-bold text-chatroom-text-primary">{restartSummary.count3h}</span>
          <span className="text-chatroom-text-muted"> in 3h</span>
          <span className="mx-1.5 text-chatroom-border-strong">·</span>
          <span className="font-bold text-chatroom-text-primary">{restartSummary.count3d}</span>
          <span className="text-chatroom-text-muted"> in 3d</span>
        </span>
        {statsMachineId && (
          <button
            type="button"
            onClick={onOpenStats}
            className="ml-auto text-[9px] font-bold uppercase tracking-widest text-chatroom-accent hover:text-chatroom-text-primary transition-colors flex-shrink-0"
          >
            View Stats →
          </button>
        )}
      </div>
      {statsMachineId && (
        <AgentRestartStatsModal
          isOpen={statsOpen}
          onClose={onCloseStats}
          roles={allRoles}
          defaultRole={role}
          machineId={statsMachineId}
          chatroomId={chatroomId}
          defaultModel={defaultModel}
        />
      )}
    </>
  );
});

/** Compact always-visible agent row with tabs for inline remote config editing. */
export const InlineAgentCard = memo(function InlineAgentCard({
  role,
  allRoles,
  online,
  lastSeenAt,
  latestEventType,
  desiredState,
  statusVariant: statusVariantProp,
  prompt,
  chatroomId,
  connectedMachines,
  isLoadingMachines,
  agentConfigs,
  sendCommand,
  agentRoleView,
  restartSummary: restartSummaryProp,
}: InlineAgentCardProps) {
  const { workspaces: chatroomWorkspaces, isLoading: chatroomWorkspacesLoading } =
    useChatroomWorkspaces(chatroomId);

  const controls = useAgentControls({
    role,
    chatroomId,
    connectedMachines,
    agentConfigs,
    sendCommand,
    teamConfigModel: agentRoleView?.model,
    teamConfigHarness: agentRoleView?.agentHarness,
    teamConfigMachineId: agentRoleView?.machineId,
    teamWantResume: agentRoleView?.wantResume,
    chatroomWorkspaces,
    chatroomWorkspacesLoading,
  });

  const linkedMachineIds = useMemo(() => {
    const s = new Set<string>();
    for (const ws of chatroomWorkspaces) {
      if (ws.machineId) s.add(ws.machineId);
    }
    return s;
  }, [chatroomWorkspaces]);

  const daemonStartCommand = getDaemonStartCommand();

  // Resolve status label and variant using the shared utility.
  // If a pre-resolved statusVariant is passed in, use it; otherwise compute locally.
  const { label: statusLabel, variant: statusVariant } = resolveAgentStatus(
    latestEventType ?? null,
    desiredState ?? null,
    online
  );
  const resolvedVariant = statusVariantProp ?? statusVariant;

  // Resolve machineId from agentConfigs for restart stats query (used for machine-specific stats modal)
  const statsMachineId = useMemo(() => {
    const config = agentConfigs.find((c) => c.role.toLowerCase() === role.toLowerCase());
    return config?.machineId ?? null;
  }, [agentConfigs, role]);

  const [statsOpen, setStatsOpen] = useState(false);

  // Always call the hook (Rules of Hooks), but skip the subscription when
  // a pre-fetched restart summary is provided by the parent batch query.
  const ownRestartSummary = useSessionQuery(
    api.machines.getAgentRestartSummaryByRole,
    restartSummaryProp != null
      ? 'skip'
      : {
          chatroomId: chatroomId as Id<'chatroom_rooms'>,
          role,
        }
  );
  const restartSummary = restartSummaryProp ?? ownRestartSummary;

  return (
    <div
      className="border-b border-chatroom-border last:border-b-0 px-4 py-3 flex items-stretch gap-3"
      /* Force WebKit compositing layer flush to prevent Safari ghost rendering */
      style={{ backfaceVisibility: 'hidden' }}
    >
      {/* Column 1: Agent details + tabs + tab content (stretches) */}
      <div className="flex flex-col min-w-0 flex-1">
        {/* Agent role */}
        <div className="mb-1">
          <AgentStatusRow role={role} online={online} />
        </div>

        {/* Tab bar + tab content */}
        <AgentControlsSection
          controls={controls}
          connectedMachines={connectedMachines}
          isLoadingMachines={isLoadingMachines}
          daemonStartCommand={daemonStartCommand}
          chatroomId={chatroomId}
          role={role}
          prompt={prompt}
          linkedMachineIds={linkedMachineIds}
          initialTab={agentRoleView?.type === 'custom' ? 'custom' : 'remote'}
        />

        {restartSummary && (
          <AgentCardRestartSection
            restartSummary={restartSummary}
            statsMachineId={statsMachineId}
            statsOpen={statsOpen}
            onOpenStats={() => setStatsOpen(true)}
            onCloseStats={() => setStatsOpen(false)}
            allRoles={allRoles}
            role={role}
            chatroomId={chatroomId}
            defaultModel={
              agentRoleView?.agentHarness && agentRoleView?.model
                ? `${agentRoleView.agentHarness}/${agentRoleView.model}`
                : undefined
            }
          />
        )}

        <AgentCardStatusFooter
          statusLabel={statusLabel}
          resolvedVariant={resolvedVariant}
          online={online}
          lastSeenAt={lastSeenAt}
        />

        <AgentCardModelLine model={agentRoleView?.model} />
      </div>
    </div>
  );
});
