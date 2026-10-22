'use client';

import { getPermanentRoleNames, isEphemeralAgentRole } from '@workspace/shared/domain/agent-role';
import type { TeamStructure } from '@workspace/shared/domain/team-presets';
import { ChevronRight, Users } from 'lucide-react';
import { useMemo, memo } from 'react';

import { CommandQueuePanel } from './AgentPanel/CommandQueuePanel';
import { RemoteAgentQuickActions } from './AgentPanel/RemoteAgentQuickActions';
import type { TeamConfigEntry } from '../hooks/use-team-configs';
import type { AgentRoleStatusReadModel } from '../hooks/useAgentPanelData';
import { useAgentStatuses } from '../hooks/useAgentStatuses';
import type { AgentStatus } from '../hooks/useAgentStatuses';
import { useRelativeTime } from '../hooks/useRelativeTime';
import { getCompactModelLabel, type AgentConfig } from '../types/machine';
import type { TeamLifecycle } from '../types/readiness';
import {
  getIndicatorClass,
  getLabelColorClass,
  getRowHighlightClass,
} from './AgentPanel/AgentStatusRow';
import { TeamSelectorDropdown } from './AgentPanel/TeamSelectorDropdown';
import { SIDEBAR_PREVIEW_LIMIT, SidebarSection } from './sidebar/SidebarSection';

import { ChatroomLoader } from '@/components/ui/chatroom-loader';

interface AgentPanelProps {
  machineId: string | null | undefined;
  teamStructure: TeamStructure | null | undefined;
  lifecycle: TeamLifecycle | null | undefined;
  statusReadModel: AgentRoleStatusReadModel[] | undefined;
  teamName: string | undefined;
  teamId: string | undefined;
  defaultTeamId: string | undefined;
  teams: readonly TeamConfigEntry[] | undefined;
  onTeamChange: ((team: TeamConfigEntry) => Promise<void>) | undefined;
  agentConfigs: AgentConfig[];
  /** Opens the single-agent config modal for this role (any agent row). */
  onOpenAgent: (role: string) => void;
  /** Opens Settings → Agents tab (sidebar "View all"). */
  onOpenAgents: () => void;
  hasRunningRemoteAgents: boolean;
  canStopRemoteAgents: boolean;
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
  onOpen: (role: string) => void;
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
          {getCompactModelLabel(agentConfig.model)}
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
  const statusLabel = agentStatus?.statusLabel ?? 'OFFLINE';
  const lastSeenAt = agentStatus?.lastSeenAt ?? null;
  const statusVariant = agentStatus?.statusVariant ?? 'offline';
  const lastSeenLabel = useRelativeTime(lastSeenAt);
  const indicatorClass = getIndicatorClass(statusVariant);
  const labelColorClass = getLabelColorClass(statusVariant);

  return (
    <div className="border-b border-chatroom-border last:border-b-0">
      <div
        className={`flex items-center gap-3 p-3 cursor-pointer transition-all duration-100 hover:bg-chatroom-bg-hover ${getRowHighlightClass(statusVariant)}`}
        role="button"
        tabIndex={0}
        aria-label={`${role}: ${isLoadingStatuses ? 'Loading...' : statusLabel}. Click to configure.`}
        data-testid={`agent-sidebar-row-${role}`}
        onClick={() => onOpen(role)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            onOpen(role);
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
  machineId,
  teamStructure,
  lifecycle,
  statusReadModel,
  teamName,
  teamId,
  defaultTeamId,
  teams,
  onTeamChange,
  agentConfigs,
  onOpenAgent,
  onOpenAgents,
  hasRunningRemoteAgents,
  canStopRemoteAgents,
  onStartAllRemoteAgents,
  onStopAllRemoteAgents,
  onRestartAllRemoteAgents,
  isStoppingAgents,
  isStartingAllAgents,
}: AgentPanelProps) {
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
  const latestAgentConfigByRole = useMemo(() => {
    const map = new Map<string, AgentConfig>();
    for (const config of agentConfigs) {
      const key = config.role.toLowerCase();
      const existing = map.get(key);
      if (!existing || config.updatedAt > existing.updatedAt) {
        map.set(key, config);
      }
    }
    return map;
  }, [agentConfigs]);
  const hiddenPermanentRoleCount = Math.max(0, permanentRoles.length - SIDEBAR_PREVIEW_LIMIT);

  // Use hook to get derived agent statuses (lifecycle + event stream)
  const { agents: agentStatuses, isLoading: isLoadingStatuses } = useAgentStatuses(
    rolesToShow,
    statusReadModel
  );

  const renderAgentRows = (roles: string[]) =>
    roles.map((role) => (
      <AgentSidebarRow
        key={role}
        role={role}
        agentStatus={agentStatuses.find((a) => a.role === role)}
        agentConfig={latestAgentConfigByRole.get(role.toLowerCase())}
        isLoadingStatuses={isLoadingStatuses}
        onOpen={onOpenAgent}
      />
    ));

  // Loading state
  if (lifecycle === undefined || teamStructure === undefined) {
    return (
      <SidebarSection.Root className="border-b-2 border-chatroom-border-strong overflow-hidden">
        <SidebarSection.Header
          title="Agents"
          count={0}
          icon={Users}
          iconClassName="text-chatroom-accent"
        />
        <SidebarSection.Loading>
          <ChatroomLoader size="md" />
        </SidebarSection.Loading>
      </SidebarSection.Root>
    );
  }

  return (
    <SidebarSection.Root className="border-b-2 border-chatroom-border-strong overflow-hidden flex flex-col">
      <SidebarSection.Header
        title="Agents"
        count={rolesToShow.length}
        icon={Users}
        iconClassName="text-chatroom-accent"
      />

      {/* Team selector — own row below the Agents header */}
      {teams && defaultTeamId && onTeamChange && (
        <SidebarSection.Toolbar>
          <div className="flex-1 min-w-0">
            <TeamSelectorDropdown
              teamName={teamName ?? 'Select team'}
              teamId={teamId}
              defaultTeamId={defaultTeamId}
              teams={teams}
              onTeamChange={onTeamChange}
            />
          </div>
          {teamStructure && (
            <RemoteAgentQuickActions
              hasRunningAgents={hasRunningRemoteAgents}
              canStop={canStopRemoteAgents}
              isStopping={isStoppingAgents}
              onStart={onStartAllRemoteAgents}
              onStop={onStopAllRemoteAgents}
              onRestart={onRestartAllRemoteAgents}
              disabled={isStartingAllAgents}
              isStarting={isStartingAllAgents}
            />
          )}
        </SidebarSection.Toolbar>
      )}
      <CommandQueuePanel machineId={machineId} />
      {/* Agent rows — the right sidebar container scrolls, not this wrapper */}
      <div>
        {teamStructure === null ? (
          <SidebarSection.Empty>No team configured</SidebarSection.Empty>
        ) : (
          <>
            {renderAgentRows(permanentRoles.slice(0, SIDEBAR_PREVIEW_LIMIT))}
            {ephemeralRoles.length > 0 && (
              <>
                <SidebarSection.Subheader>
                  Ephemeral ({ephemeralRoles.length})
                </SidebarSection.Subheader>
                {renderAgentRows(ephemeralRoles)}
              </>
            )}
          </>
        )}
      </div>
      <SidebarSection.ViewMore count={hiddenPermanentRoleCount} onClick={onOpenAgents} />
    </SidebarSection.Root>
  );
});
