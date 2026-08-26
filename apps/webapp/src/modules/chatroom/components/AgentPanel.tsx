'use client';

import { getPermanentRoleNames, isEphemeralAgentRole } from '@workspace/shared/domain/agent-role';
import type { TeamStructure } from '@workspace/shared/domain/team-presets';
import { ChevronRight } from 'lucide-react';
import { useState, useMemo, useCallback, memo } from 'react';

import { RemoteAgentQuickActions } from './AgentPanel/RemoteAgentQuickActions';
import type { TeamConfigEntry } from '../hooks/use-team-configs';
import { useAgentStatuses } from '../hooks/useAgentStatuses';
import type { AgentStatus } from '../hooks/useAgentStatuses';
import { useRelativeTime } from '../hooks/useRelativeTime';
import { getCompactModelId, type AgentConfig } from '../types/machine';
import type { TeamLifecycle } from '../types/readiness';
import {
  getIndicatorClass,
  getLabelColorClass,
  getRowHighlightClass,
} from './AgentPanel/AgentStatusRow';
import { TeamSelectorDropdown } from './AgentPanel/TeamSelectorDropdown';
import { UnifiedAgentListModal } from './AgentPanel/UnifiedAgentListModal';

import { ChatroomLoader } from '@/components/ui/chatroom-loader';

interface AgentPanelProps {
  chatroomId: string;
  teamStructure: TeamStructure | null | undefined;
  lifecycle: TeamLifecycle | null | undefined;
  teamName: string | undefined;
  teamId: string | undefined;
  defaultTeamId: string | undefined;
  teams: readonly TeamConfigEntry[] | undefined;
  onTeamChange: ((team: TeamConfigEntry) => Promise<void>) | undefined;
  agentConfigs: AgentConfig[];
  /** Called when user clicks an agent row — opens settings to agents tab */
  onOpenAgents: (() => void) | undefined;
  hasRunningRemoteAgents: boolean;
  onStartAllRemoteAgents: (() => void) | undefined;
  onStopAllRemoteAgents: (() => void) | undefined;
  onRestartAllRemoteAgents: (() => void) | undefined;
  isStoppingAgents: boolean;
  isStartingAllAgents: boolean;
}

// ─── AgentSidebarRow ─────────────────────────────────────────────────────────

interface AgentSidebarRowProps {
  role: string;
  agentStatus: AgentStatus | undefined;
  agentConfig: AgentConfig | undefined;
  isLoadingStatuses: boolean;
  onOpen: () => void;
}

interface AgentSidebarInfoProps {
  role: string;
  agentConfig: AgentConfig | undefined;
  isLoadingStatuses: boolean;
  statusLabel: string;
  labelColorClass: string;
  lastSeenLabel: string;
}

const AgentSidebarInfo = memo(function AgentSidebarInfo({
  role,
  agentConfig,
  isLoadingStatuses,
  statusLabel,
  labelColorClass,
  lastSeenLabel,
}: AgentSidebarInfoProps) {
  return (
    <div className="flex-1 min-w-0">
      <div className="text-xs font-bold uppercase tracking-wide text-chatroom-text-primary">
        {role}
      </div>
      <div className="text-[10px] font-bold uppercase tracking-wide">
        <span
          className={isLoadingStatuses ? 'text-chatroom-text-muted animate-pulse' : labelColorClass}
        >
          {isLoadingStatuses ? '...' : statusLabel}
        </span>
        <span className="text-chatroom-text-muted mx-1.5">·</span>
        <span className="text-chatroom-text-muted">{lastSeenLabel}</span>
      </div>
      {agentConfig?.model && (
        <div className="text-[10px] font-bold uppercase tracking-wide text-chatroom-text-muted truncate">
          {getCompactModelId(agentConfig.model)}
        </div>
      )}
    </div>
  );
});

/** A single agent row in the AgentPanel sidebar. Extracted as a proper component so
 *  React can correctly reconcile keyed list items — keys must be on elements directly
 *  returned from `.map()`, not inside helper functions. */
const AgentSidebarRow = memo(function AgentSidebarRow({
  role,
  agentStatus,
  agentConfig,
  isLoadingStatuses,
  onOpen,
}: AgentSidebarRowProps) {
  const online_ = agentStatus?.online ?? false;
  const statusLabel = agentStatus?.statusLabel ?? 'OFFLINE';
  const lastSeenAt = agentStatus?.lastSeenAt ?? null;
  const statusVariant = agentStatus?.statusVariant;
  const lastSeenLabel = useRelativeTime(lastSeenAt);
  const indicatorClass = getIndicatorClass(statusVariant, online_);
  const labelColorClass = getLabelColorClass(statusVariant, online_);

  return (
    <div className="border-b border-chatroom-border last:border-b-0">
      <div
        className={`flex items-center gap-3 p-3 cursor-pointer transition-all duration-100 hover:bg-chatroom-bg-hover ${getRowHighlightClass(statusVariant)}`}
        role="button"
        tabIndex={0}
        aria-label={`${role}: ${isLoadingStatuses ? 'Loading...' : statusLabel}. Click to view all agents.`}
        onClick={onOpen}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            onOpen();
          }
        }}
      >
        {/* Status Indicator */}
        <div
          className={`w-2.5 h-2.5 flex-shrink-0 ${indicatorClass}`}
          role="status"
          aria-label={`Status: ${isLoadingStatuses ? 'Loading...' : statusLabel}`}
        />
        <AgentSidebarInfo
          role={role}
          agentConfig={agentConfig}
          isLoadingStatuses={isLoadingStatuses}
          statusLabel={statusLabel}
          labelColorClass={labelColorClass}
          lastSeenLabel={lastSeenLabel}
        />
        {/* View Indicator */}
        <div className="text-chatroom-text-muted">
          <ChevronRight size={14} />
        </div>
      </div>
    </div>
  );
});

// ─── AgentPanel ──────────────────────────────────────────────────────────────

export const AgentPanel = memo(function AgentPanel({
  chatroomId,
  teamStructure,
  lifecycle,
  teamName,
  teamId,
  defaultTeamId,
  teams,
  onTeamChange,
  agentConfigs,
  onOpenAgents,
  hasRunningRemoteAgents,
  onStartAllRemoteAgents,
  onStopAllRemoteAgents,
  onRestartAllRemoteAgents,
  isStoppingAgents,
  isStartingAllAgents,
}: AgentPanelProps) {
  const [isAgentListModalOpen, setIsAgentListModalOpen] = useState(false);

  const displayRoles = useMemo(() => {
    const base = teamStructure?.roles.map(({ role }) => role) ?? [];
    return base.filter((role) => role !== 'user');
  }, [teamStructure?.roles]);
  const permanentRoles = useMemo(() => getPermanentRoleNames(displayRoles), [displayRoles]);
  const ephemeralRoles = useMemo(
    () => displayRoles.filter((role) => isEphemeralAgentRole(role)),
    [displayRoles]
  );
  const rolesToShow = useMemo(
    () => [...permanentRoles, ...ephemeralRoles],
    [permanentRoles, ephemeralRoles]
  );

  // Use hook to get derived agent statuses (lifecycle + event stream)
  const { agents: agentStatuses, isLoading: isLoadingStatuses } = useAgentStatuses(
    rolesToShow,
    lifecycle?.participants
  );

  // Open agent list — if onOpenAgents is provided, open settings to agents tab;
  // otherwise fall back to the standalone UnifiedAgentListModal
  const openAgentListModal = useCallback(() => {
    if (onOpenAgents) {
      onOpenAgents();
    } else {
      setIsAgentListModalOpen(true);
    }
  }, [onOpenAgents]);

  // Close unified agent list modal
  const closeAgentListModal = useCallback(() => {
    setIsAgentListModalOpen(false);
  }, []);

  const renderAgentRows = (roles: string[]) =>
    roles.map((role) => (
      <AgentSidebarRow
        key={role}
        role={role}
        agentStatus={agentStatuses.find((a) => a.role === role)}
        agentConfig={agentConfigs.find((c) => c.role.toLowerCase() === role.toLowerCase())}
        isLoadingStatuses={isLoadingStatuses}
        onOpen={openAgentListModal}
      />
    ));

  // Loading state
  if (lifecycle === undefined || teamStructure === undefined) {
    return (
      <div className="flex flex-col border-b-2 border-chatroom-border-strong overflow-hidden">
        <div className="text-[10px] font-bold uppercase tracking-widest text-chatroom-text-muted p-4 border-b-2 border-chatroom-border">
          Agents
        </div>
        <div className="p-4 flex items-center justify-center">
          <ChatroomLoader size="md" />
        </div>
      </div>
    );
  }

  // Legacy chatroom without team
  if (lifecycle === null) {
    return (
      <div className="flex flex-col border-b-2 border-chatroom-border-strong overflow-hidden">
        <div className="text-[10px] font-bold uppercase tracking-widest text-chatroom-text-muted p-4 border-b-2 border-chatroom-border">
          Agents
        </div>
        <div className="p-4 text-center text-chatroom-text-muted text-xs">No team configured</div>
      </div>
    );
  }

  return (
    <div className="flex flex-col border-b-2 border-chatroom-border-strong overflow-hidden">
      <div className="flex items-center h-14 px-4 border-b-2 border-chatroom-border min-w-0">
        <div className="text-[10px] font-bold uppercase tracking-widest text-chatroom-text-muted">
          Agents
        </div>
      </div>

      {/* Team selector — own row below the Agents header */}
      {teamName && teams && defaultTeamId && onTeamChange && (
        <div className="px-4 py-2 border-b border-chatroom-border/50 flex items-center gap-4">
          <div className="flex-1 min-w-0">
            <TeamSelectorDropdown
              teamName={teamName}
              teamId={teamId}
              defaultTeamId={defaultTeamId}
              teams={teams}
              onTeamChange={onTeamChange}
            />
          </div>
          <RemoteAgentQuickActions
            hasRunningAgents={hasRunningRemoteAgents}
            isStopping={isStoppingAgents}
            onStart={onStartAllRemoteAgents}
            onStop={onStopAllRemoteAgents}
            onRestart={onRestartAllRemoteAgents}
            disabled={isStartingAllAgents}
            isStarting={isStartingAllAgents}
          />
        </div>
      )}
      {/* Scrollable container for agent rows */}
      <div className="overflow-y-auto">
        {renderAgentRows(permanentRoles)}
        {ephemeralRoles.length > 0 && (
          <>
            <div className="text-[10px] font-bold uppercase tracking-widest text-chatroom-text-muted px-4 py-2 border-t border-chatroom-border">
              Ephemeral
            </div>
            {renderAgentRows(ephemeralRoles)}
          </>
        )}
      </div>

      {/* Unified Agent List Modal - shows ALL agents with inline config/controls */}
      <UnifiedAgentListModal
        isOpen={isAgentListModalOpen}
        onClose={closeAgentListModal}
        chatroomId={chatroomId}
      />
    </div>
  );
});
