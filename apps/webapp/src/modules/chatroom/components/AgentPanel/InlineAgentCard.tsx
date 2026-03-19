'use client';

import { api } from '@workspace/backend/convex/_generated/api';
import type { Id } from '@workspace/backend/convex/_generated/dataModel';
import type { AgentRoleView } from '@workspace/backend/src/domain/usecase/chatroom/get-agent-statuses';
import { useSessionQuery } from 'convex-helpers/react/sessions';
import React, { memo, useState, useMemo } from 'react';

import type { MachineInfo, AgentConfig, SendCommandFn } from '../../types/machine';
import { useAgentControls } from '../AgentConfigTabs';
import type { AgentPreference } from '../AgentConfigTabs';
import { AgentControlsSection } from './AgentControlsSection';
import { AgentRestartStatsModal } from './AgentRestartStatsModal';
import { AgentStatusRow } from './AgentStatusRow';
import { resolveAgentStatus, type StatusVariant } from '../../utils/agentStatusLabel';

import { getDaemonStartCommand } from '@/lib/environment';

// Re-export helpers that are still imported from this file elsewhere
export { formatLastSeen } from './AgentStatusRow';

// ─── Helper functions ────────────────────────────────────────────────────────

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
  desiredState,
  statusVariant: statusVariantProp,
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

  // Always fetch restart stats by chatroom+role (aggregated across all machines) so the
  // metrics section is always visible regardless of whether a machine config exists.
  const restartSummary = useSessionQuery(api.machines.getAgentRestartSummaryByRole, {
    chatroomId: chatroomId as Id<'chatroom_rooms'>,
    role,
  });

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
            statusVariant={resolvedVariant}
            lastSeenAt={lastSeenAt}
          />
        </div>

        {/* Tab bar + tab content */}
        <AgentControlsSection
          controls={controls}
          connectedMachines={connectedMachines}
          isLoadingMachines={isLoadingMachines}
          daemonStartCommand={daemonStartCommand}
          role={role}
          prompt={prompt}
          initialTab={agentRoleView?.type === 'custom' ? 'custom' : 'remote'}
        />

        {/* Restart stats row — always shown when data is loaded */}
        {restartSummary && (
          <>
            <div className="mt-2 pt-2 border-t border-chatroom-border flex items-center gap-2">
              <span className="text-[9px] font-bold uppercase tracking-widest text-chatroom-text-muted flex-shrink-0">
                Restarts
              </span>
              <span className="text-[10px] text-chatroom-text-secondary">
                <span className="font-bold text-chatroom-text-primary">
                  {restartSummary.count1h}
                </span>
                <span className="text-chatroom-text-muted"> in 1h</span>
                <span className="mx-1.5 text-chatroom-border-strong">·</span>
                <span className="font-bold text-chatroom-text-primary">
                  {restartSummary.count24h}
                </span>
                <span className="text-chatroom-text-muted"> in 24h</span>
              </span>
              {statsMachineId && (
                <button
                  type="button"
                  onClick={() => setStatsOpen(true)}
                  className="ml-auto text-[9px] font-bold uppercase tracking-widest text-chatroom-accent hover:text-chatroom-text-primary transition-colors flex-shrink-0"
                >
                  View Stats →
                </button>
              )}
            </div>

            {statsMachineId && (
              <AgentRestartStatsModal
                isOpen={statsOpen}
                onClose={() => setStatsOpen(false)}
                role={role}
                machineId={statsMachineId}
                chatroomId={chatroomId}
              />
            )}
          </>
        )}
      </div>
    </div>
  );
});
