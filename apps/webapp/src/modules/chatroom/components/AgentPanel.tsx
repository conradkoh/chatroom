'use client';

import { ChevronRight, Settings, RefreshCw } from 'lucide-react';
import { useState, useMemo, useCallback, memo } from 'react';
import { toast } from 'sonner';

import { useAgentStatuses } from '../hooks/useAgentStatuses';
import type { AgentStatus } from '../hooks/useAgentStatuses';
import { useRelativeTime } from '../hooks/useRelativeTime';
import type { TeamLifecycle } from '../types/readiness';
import { UnifiedAgentListModal } from './AgentPanel/UnifiedAgentListModal';
import { useSessionMutation } from 'convex-helpers/react/sessions';
import { api } from '@workspace/backend/convex/_generated/api';

interface AgentPanelProps {
  chatroomId: string;
  teamRoles?: string[];
  lifecycle: TeamLifecycle | null | undefined;
  /** Called when user clicks Configure in the menu */
  onConfigure?: () => void;
  /** Called when user clicks an agent row — opens settings to agents tab */
  onOpenAgents?: () => void;
}

// ─── AgentSidebarRow ─────────────────────────────────────────────────────────

interface AgentSidebarRowProps {
  role: string;
  agentStatus: AgentStatus | undefined;
  isLoadingStatuses: boolean;
  onOpen: () => void;
}

/** A single agent row in the AgentPanel sidebar. Extracted as a proper component so
 *  React can correctly reconcile keyed list items — keys must be on elements directly
 *  returned from `.map()`, not inside helper functions. */
const AgentSidebarRow = memo(function AgentSidebarRow({
  role,
  agentStatus,
  isLoadingStatuses,
  onOpen,
}: AgentSidebarRowProps) {
  const online_ = agentStatus?.online ?? false;
  const working_ = agentStatus?.isWorking ?? false;
  const statusLabel = agentStatus?.statusLabel ?? 'OFFLINE';
  const lastSeenAt = agentStatus?.lastSeenAt ?? null;
  const statusVariant = agentStatus?.statusVariant;
  const lastSeenLabel = useRelativeTime(lastSeenAt);

  // Map statusVariant to indicator dot color
  const indicatorClass = (() => {
    switch (statusVariant) {
      case 'offline':
        return 'bg-chatroom-text-muted';
      case 'error':
        return 'bg-red-500 dark:bg-red-400';
      case 'transitioning':
        return 'bg-yellow-500 dark:bg-yellow-400';
      case 'ready':
        return 'bg-chatroom-status-success';
      case 'working':
        return 'bg-chatroom-status-info animate-pulse';
      default:
        return online_ ? 'bg-chatroom-status-success' : 'bg-chatroom-text-muted';
    }
  })();

  // Map statusVariant to label text color
  const labelColorClass = (() => {
    switch (statusVariant) {
      case 'offline':
        return 'text-chatroom-text-muted';
      case 'error':
        return 'text-red-600 dark:text-red-400';
      case 'transitioning':
        return 'text-yellow-600 dark:text-yellow-400';
      case 'ready':
        return 'text-chatroom-status-success';
      case 'working':
        return 'text-chatroom-status-info animate-pulse';
      default:
        return working_
          ? 'text-chatroom-status-info animate-pulse'
          : online_
            ? 'text-chatroom-status-success'
            : 'text-chatroom-text-muted';
    }
  })();

  return (
    <div className="border-b border-chatroom-border last:border-b-0">
      <div
        className={`flex items-center gap-3 p-3 cursor-pointer transition-all duration-100 hover:bg-chatroom-bg-hover ${working_ ? 'bg-chatroom-status-info/5' : ''}`}
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
        {/* Agent Info */}
        <div className="flex-1 min-w-0">
          <div className="text-xs font-bold uppercase tracking-wide text-chatroom-text-primary">
            {role}
          </div>
          <div
            className={`text-[10px] font-bold uppercase tracking-wide ${
              isLoadingStatuses ? 'text-chatroom-text-muted animate-pulse' : labelColorClass
            }`}
          >
            {isLoadingStatuses ? '...' : statusLabel}
          </div>
          <div className="text-[10px] font-bold uppercase tracking-wide text-chatroom-text-muted">
            {lastSeenLabel}
          </div>
        </div>
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
  teamRoles = [],
  lifecycle,
  onConfigure,
  onOpenAgents,
}: AgentPanelProps) {
  const [isAgentListModalOpen, setIsAgentListModalOpen] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [lastRefreshAt, setLastRefreshAt] = useState(0);

  // Refresh mutation with session awareness
  const requestRefresh = useSessionMutation(api.machines.requestCapabilitiesRefresh);

  // Determine if button should be disabled (cooldown)
  const isInCooldown = Date.now() - lastRefreshAt < 10_000; // 10 second cooldown

  const handleRefresh = useCallback(async () => {
    if (isRefreshing || isInCooldown) return;

    setIsRefreshing(true);
    try {
      const result = await requestRefresh({ chatroomId: chatroomId as any });
      toast.success(`Capabilities refresh requested (${result.fannedOut} machine(s))`);
      setLastRefreshAt(Date.now());
    } catch (error) {
      toast.error('Failed to request capabilities refresh');
    } finally {
      setIsRefreshing(false);
    }
  }, [chatroomId, isRefreshing, isInCooldown, requestRefresh]);

  // Determine which roles to show (memoized)
  const rolesToShow = useMemo(
    () => (teamRoles.length > 0 ? teamRoles : lifecycle?.expectedRoles || []),
    [teamRoles, lifecycle?.expectedRoles]
  );

  // Use hook to get derived agent statuses (lifecycle + event stream)
  const { agents: agentStatuses, isLoading: isLoadingStatuses } = useAgentStatuses(
    chatroomId,
    rolesToShow
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

  // Loading state
  if (lifecycle === undefined) {
    return (
      <div className="flex flex-col border-b-2 border-chatroom-border-strong overflow-hidden">
        <div className="text-[10px] font-bold uppercase tracking-widest text-chatroom-text-muted p-4 border-b-2 border-chatroom-border">
          Agents
        </div>
        <div className="p-4 flex items-center justify-center">
          <div className="w-5 h-5 border-2 border-chatroom-border border-t-chatroom-accent animate-spin" />
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
      {/* Header with settings and refresh buttons */}
      <div className="flex items-center justify-between h-14 px-4 border-b-2 border-chatroom-border">
        <div className="text-[10px] font-bold uppercase tracking-widest text-chatroom-text-muted">
          Agents
        </div>
        <div className="flex items-center gap-2">
          {/* Refresh button — requests capabilities refresh */}
          <button
            type="button"
            onClick={handleRefresh}
            disabled={isRefreshing || isInCooldown}
            className="w-6 h-6 flex items-center justify-center text-chatroom-text-muted hover:text-chatroom-text-primary transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            title="Refresh capabilities (models & harnesses)"
            aria-label="Refresh capabilities"
          >
            <RefreshCw size={14} className={isRefreshing ? 'animate-spin' : ''} />
          </button>
          {/* Settings button — opens settings panel directly */}
          <button
            type="button"
            onClick={onConfigure}
            className="w-6 h-6 flex items-center justify-center text-chatroom-text-muted hover:text-chatroom-text-primary transition-colors"
            title="Configure agents"
            aria-label="Configure agents"
          >
            <Settings size={14} />
          </button>
        </div>
      </div>
      {/* Scrollable container for agent rows */}
      <div className="overflow-y-auto">
        {/* Each AgentSidebarRow is a proper component with key at the map level */}
        {agentStatuses.map(({ role }) => (
          <AgentSidebarRow
            key={role}
            role={role}
            agentStatus={agentStatuses.find((a) => a.role === role)}
            isLoadingStatuses={isLoadingStatuses}
            onOpen={openAgentListModal}
          />
        ))}
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
