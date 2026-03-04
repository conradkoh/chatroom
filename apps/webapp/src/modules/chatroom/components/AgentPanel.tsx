'use client';

import { ChevronRight, AlertTriangle, MoreHorizontal, Settings } from 'lucide-react';
import React, { useState, useMemo, useCallback, memo } from 'react';

import type { TeamLifecycle } from '../types/readiness';
import { usePresenceTick } from '../hooks/usePresenceTick';
import { useAgentStatuses } from '../hooks/useAgentStatuses';
import { UnifiedAgentListModal } from './AgentPanel/UnifiedAgentListModal';

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { usePrompts } from '@/contexts/PromptsContext';

interface AgentPanelProps {
  chatroomId: string;
  teamRoles?: string[];
  lifecycle: TeamLifecycle | null | undefined;
  onViewPrompt?: (role: string) => void;
  /** Called when user clicks Configure in the menu */
  onConfigure?: () => void;
}

// ─── Presence Utilities ──────────────────────────────────────────────────────

/** Pure helper — formats a lastSeenAt unix-ms timestamp into a human-readable "X ago" string. */
function formatLastSeen(lastSeenAt: number | null | undefined): string {
  if (lastSeenAt == null) return 'never';
  const diff = Math.floor((Date.now() - lastSeenAt) / 1000);
  if (diff < 60) return 'just now';
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  return `${Math.floor(diff / 3600)}h ago`;
}



export const AgentPanel = memo(function AgentPanel({
  chatroomId,
  teamRoles = [],
  lifecycle,
  onViewPrompt,
  onConfigure,
}: AgentPanelProps) {
  const [isAgentListModalOpen, setIsAgentListModalOpen] = useState(false);

  // Tick every 30s so presence checks (isOnline, formatLastSeen) stay current
  // without needing a DB write to trigger a Convex query re-run.
  usePresenceTick();

  const { getAgentPrompt } = usePrompts();

  // Determine which roles to show (memoized)
  const rolesToShow = useMemo(
    () => (teamRoles.length > 0 ? teamRoles : lifecycle?.expectedRoles || []),
    [teamRoles, lifecycle?.expectedRoles]
  );

  // Use hook to get derived agent statuses (lifecycle + event stream)
  const { agents: agentStatuses } = useAgentStatuses(chatroomId, rolesToShow);


  // Memoize prompt generation function
  const generatePrompt = useCallback(
    (role: string): string => {
      return getAgentPrompt(role) || '';
    },
    [getAgentPrompt]
  );

  // Build unified list of all agents with their presence (for UnifiedAgentListModal)
  const allAgentsWithStatus = useMemo(() => {
    return agentStatuses.map(({ role, online, lastSeenAt, latestEventType, isStuck }) => ({
      role,
      online,
      lastSeenAt,
      latestEventType,
      isStuck,
    }));
  }, [agentStatuses]);

  // Open unified agent list modal
  const openAgentListModal = useCallback(() => {
    setIsAgentListModalOpen(true);
  }, []);

  // Close unified agent list modal
  const closeAgentListModal = useCallback(() => {
    setIsAgentListModalOpen(false);
  }, []);

  // Loading state
  if (lifecycle === undefined) {
    return (
      <div className="flex flex-col border-b-2 border-chatroom-border-strong overflow-hidden flex-1">
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
      <div className="flex flex-col border-b-2 border-chatroom-border-strong overflow-hidden flex-1">
        <div className="text-[10px] font-bold uppercase tracking-widest text-chatroom-text-muted p-4 border-b-2 border-chatroom-border">
          Agents
        </div>
        <div className="p-4 text-center text-chatroom-text-muted text-xs">No team configured</div>
      </div>
    );
  }

  // Helper to render an agent row in the sidebar
  const renderAgentRow = (role: string) => {
    const agentStatus = agentStatuses.find((a) => a.role === role);
    const online_ = agentStatus?.online ?? false;
    const working_ = agentStatus?.isWorking ?? false;
    const isStuck = agentStatus?.isStuck ?? false;
    const statusLabel = agentStatus?.statusLabel ?? 'ONLINE';
    const lastSeenAt = agentStatus?.lastSeenAt ?? null;

    const indicatorClass = online_ ? 'bg-chatroom-status-success' : 'bg-chatroom-text-muted';

    return (
      <div key={role} className="border-b border-chatroom-border last:border-b-0">
        <div
          className={`flex items-center gap-3 p-3 cursor-pointer transition-all duration-100 hover:bg-chatroom-bg-hover ${working_ ? 'bg-chatroom-status-info/5' : ''} ${isStuck ? 'bg-chatroom-status-warning/5' : ''}`}
          role="button"
          tabIndex={0}
          aria-label={`${role}: ${statusLabel}${isStuck ? ' (stuck)' : ''}. Click to view all agents.`}
          onClick={openAgentListModal}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              openAgentListModal();
            }
          }}
        >
          {/* Status Indicator */}
          <div
            className={`w-2.5 h-2.5 flex-shrink-0 ${indicatorClass}`}
            role="status"
            aria-label={`Status: ${statusLabel}`}
          />
          {/* Agent Info */}
          <div className="flex-1 min-w-0">
            <div className="text-xs font-bold uppercase tracking-wide text-chatroom-text-primary">
              {role}
            </div>
            <div
              className={`text-[10px] font-bold uppercase tracking-wide ${
                working_
                  ? 'text-chatroom-status-info animate-pulse'
                  : online_
                    ? 'text-chatroom-status-success'
                    : 'text-chatroom-text-muted'
              }`}
            >
              {statusLabel}
            </div>
            <div className="text-[10px] font-bold uppercase tracking-wide text-chatroom-text-muted">
              {formatLastSeen(lastSeenAt)}
            </div>
          </div>
          {/* Stuck warning badge */}
          {isStuck && (
            <AlertTriangle
              size={12}
              className="text-chatroom-status-warning flex-shrink-0"
              aria-label="Agent may be stuck"
            />
          )}
          {/* View Indicator */}
          <div className="text-chatroom-text-muted">
            <ChevronRight size={14} />
          </div>
        </div>
      </div>
    );
  };

  return (
    <div className="flex flex-col border-b-2 border-chatroom-border-strong overflow-hidden">
      {/* Header with settings menu */}
      <div className="flex items-center justify-between h-14 px-4 border-b-2 border-chatroom-border">
        <div className="text-[10px] font-bold uppercase tracking-widest text-chatroom-text-muted">
          Agents
        </div>
        {/* Settings Menu */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button className="w-6 h-6 flex items-center justify-center text-chatroom-text-muted hover:text-chatroom-text-primary transition-colors">
              <MoreHorizontal size={14} />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="chatroom-root">
            <DropdownMenuItem
              onClick={onConfigure}
              className="flex items-center gap-2 text-xs cursor-pointer"
            >
              <Settings size={12} />
              Configure
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      {/* Scrollable container for agent rows */}
      <div className="overflow-y-auto">
        {/* All agents as individual compact rows */}
        {allAgentsWithStatus.map(({ role }) => renderAgentRow(role))}
      </div>

      {/* Unified Agent List Modal - shows ALL agents with inline config/controls */}
      <UnifiedAgentListModal
        isOpen={isAgentListModalOpen}
        onClose={closeAgentListModal}
        agents={allAgentsWithStatus}
        generatePrompt={generatePrompt}
        chatroomId={chatroomId}
        onViewPrompt={onViewPrompt}
      />
    </div>
  );
});

