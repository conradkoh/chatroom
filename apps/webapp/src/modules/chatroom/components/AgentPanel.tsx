'use client';

import { api } from '@workspace/backend/convex/_generated/api';
import type { Id } from '@workspace/backend/convex/_generated/dataModel';
import { useSessionMutation, useSessionQuery } from 'convex-helpers/react/sessions';
import {
  ChevronRight,
  AlertTriangle,
  ChevronDown,
  ChevronUp,
  MoreHorizontal,
  Settings,
} from 'lucide-react';
import React, { useState, useMemo, useCallback, memo, useEffect } from 'react';

import { useAgentControls, AgentConfigTabs, AgentStatusBanner } from './AgentConfigTabs';
import type { AgentPreference } from './AgentConfigTabs';
import { CopyButton } from './CopyButton';
import type { AgentHarness, MachineInfo, AgentConfig, SendCommandFn } from '../types/machine';
import type { ParticipantInfo, TeamLifecycle } from '../types/readiness';

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  FixedModal,
  FixedModalContent,
  FixedModalHeader,
  FixedModalTitle,
  FixedModalBody,
} from '@/components/ui/fixed-modal';
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

/**
 * Agents unseen for longer than this threshold are considered offline.
 * Must stay in sync with PRESENCE_THRESHOLD_MS in services/backend/config/reliability.ts.
 */
const PRESENCE_THRESHOLD_MS = 600_000; // 10 minutes

/** Returns true if the agent is considered online (seen within threshold). */
function isOnline(lastSeenAt: number | null | undefined): boolean {
  if (lastSeenAt == null) return false;
  return Date.now() - lastSeenAt <= PRESENCE_THRESHOLD_MS;
}

/**
 * Maps a chatroom_eventStream event type to a human-readable status label.
 * Used to derive UI status from the event stream instead of lastSeenAction heartbeats.
 */
function eventTypeToStatusLabel(eventType: string | null | undefined): string {
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

/**
 * Returns true if the agent is considered "working" — online and not in the idle waiting state.
 * Working agents are shown individually (not grouped) in the sidebar.
 * Idle = agent.waiting or agent.registered (standing by).
 */
function isWorkingFromEvent(online: boolean, latestEventType: string | null | undefined): boolean {
  if (!online) return false;
  // Idle states: waiting in get-next-task loop, just registered, stopped
  if (
    latestEventType === 'agent.waiting' ||
    latestEventType === 'agent.registered' ||
    latestEventType === 'agent.exited' ||
    latestEventType == null
  ) {
    return false;
  }
  return true;
}

/**
 * Hook that returns a monotonically-increasing tick counter, updated every
 * `intervalMs` milliseconds.  Components that call this will re-render on
 * each tick, ensuring that time-based checks (isOnline, formatLastSeen) stay
 * accurate without needing a DB write to trigger a Convex query re-run.
 */
function usePresenceTick(intervalMs = 30_000): number {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return tick;
}

/** Pure helper — formats a lastSeenAt unix-ms timestamp into a human-readable "X ago" string. */
function formatLastSeen(lastSeenAt: number | null | undefined): string {
  if (lastSeenAt == null) return 'never';
  const diff = Math.floor((Date.now() - lastSeenAt) / 1000);
  if (diff < 60) return 'just now';
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  return `${Math.floor(diff / 3600)}h ago`;
}

// Collapsed Agent Group Component - shows a collapsed row that opens the unified modal
interface CollapsedAgentGroupProps {
  title: string;
  agents: string[];
  variant: 'online' | 'offline';
  onOpenModal: () => void;
}

const CollapsedAgentGroup = memo(function CollapsedAgentGroup({
  title,
  agents,
  variant,
  onOpenModal,
}: CollapsedAgentGroupProps) {
  const indicatorClass =
    variant === 'online' ? 'bg-chatroom-status-success' : 'bg-chatroom-text-muted';

  return (
    <div className="border-b border-chatroom-border last:border-b-0">
      {/* Clickable Header - opens unified modal */}
      <div
        className="flex items-center gap-3 p-3 cursor-pointer transition-colors hover:bg-chatroom-bg-hover"
        role="button"
        tabIndex={0}
        aria-label={`${title} agents (${agents.length}). Click to view all agents.`}
        onClick={onOpenModal}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            onOpenModal();
          }
        }}
      >
        {/* Status Indicator - square per theme.md */}
        <div className={`w-2.5 h-2.5 flex-shrink-0 ${indicatorClass}`} />
        {/* Group Info */}
        <div className="flex-1 min-w-0">
          <div className="text-xs font-bold uppercase tracking-wider text-chatroom-text-primary">
            {title}
            <span className="ml-1.5 text-chatroom-text-muted">({agents.length})</span>
          </div>
          <div className="text-[10px] font-bold uppercase tracking-wider text-chatroom-text-muted truncate">
            {agents.map((r) => r.toUpperCase()).join(', ')}
          </div>
        </div>
        {/* View More Indicator */}
        <ChevronRight className="h-4 w-4 text-chatroom-text-muted" />
      </div>
    </div>
  );
});

// Agent info with presence for the unified modal
interface AgentWithStatus {
  role: string;
  online: boolean;
  lastSeenAt?: number | null;
  latestEventType?: string | null;
  isStuck?: boolean;
}

// Types and constants imported from ../types/machine

// Team agent config shape matching the backend response
interface TeamAgentConfig {
  role: string;
  type: 'remote' | 'custom';
  machineId?: string;
  agentHarness?: AgentHarness;
  model?: string;
  workingDir?: string;
}

// Inline Agent Card - shows agent config, prompt, and controls directly in the modal
interface InlineAgentCardProps {
  role: string;
  online: boolean;
  lastSeenAt?: number | null;
  latestEventType?: string | null;
  isStuck?: boolean;
  prompt: string;
  chatroomId: string;
  connectedMachines: MachineInfo[];
  agentConfigs: AgentConfig[];
  isLoadingMachines: boolean;
  daemonStartCommand: string;
  sendCommand: SendCommandFn;
  onViewPrompt?: (role: string) => void;
  teamConfig?: TeamAgentConfig;
  /** User's saved preference for this role's remote agent config */
  agentPreference?: AgentPreference;
  /** Called when user starts an agent — persists preference to backend */
  onSavePreference?: (pref: AgentPreference) => void;
}

// Resolve machine hostname from connected machines by machineId
function resolveMachineHostname(
  machineId: string | undefined,
  connectedMachines: MachineInfo[]
): string | undefined {
  if (!machineId) return undefined;
  const machine = connectedMachines.find((m) => m.machineId === machineId);
  return machine?.hostname;
}

const InlineAgentCard = memo(function InlineAgentCard({
  role,
  online,
  lastSeenAt,
  latestEventType,
  isStuck,
  prompt,
  chatroomId,
  connectedMachines,
  agentConfigs,
  isLoadingMachines,
  daemonStartCommand,
  sendCommand,
  onViewPrompt,
  teamConfig,
  agentPreference,
  onSavePreference,
}: InlineAgentCardProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const [activeTab, setActiveTab] = useState<'remote' | 'custom'>('remote');

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

  const indicatorClass = online ? 'bg-chatroom-status-success' : 'bg-chatroom-text-muted';
  // Derive status from event stream (event-driven status, not heartbeat string)
  const statusLabel = online ? eventTypeToStatusLabel(latestEventType) : 'OFFLINE';
  const statusColorClass = online ? 'text-chatroom-status-success' : 'text-chatroom-text-muted';

  // Resolve machine hostname for remote agents
  const machineHostname = useMemo(
    () => resolveMachineHostname(teamConfig?.machineId, connectedMachines),
    [teamConfig?.machineId, connectedMachines]
  );

  // Build agent type detail parts for the subtitle line
  const agentTypeDetails = useMemo(() => {
    if (!teamConfig) return null;

    const parts: string[] = [teamConfig.type.toUpperCase()];
    if (teamConfig.type === 'remote') {
      if (teamConfig.agentHarness) parts.push(teamConfig.agentHarness);
      if (machineHostname) parts.push(machineHostname);
      else if (teamConfig.machineId) parts.push(teamConfig.machineId.slice(0, 8));
    }
    return parts;
  }, [teamConfig, machineHostname]);

  return (
    <div className="border-b-2 border-chatroom-border last:border-b-0">
      {/* Agent Header Row - always visible */}
      <div
        className="flex items-center justify-between gap-2 p-4 cursor-pointer hover:bg-chatroom-bg-hover transition-colors"
        onClick={() => setIsExpanded((v) => !v)}
        role="button"
        tabIndex={0}
        aria-expanded={isExpanded}
        aria-label={`${role}: ${statusLabel}. Click to ${isExpanded ? 'collapse' : 'expand'} details.`}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            setIsExpanded((v) => !v);
          }
        }}
      >
        <div className="flex flex-col gap-0.5 min-w-0">
          <div className="flex items-center gap-2">
            <div className={`w-2.5 h-2.5 flex-shrink-0 ${indicatorClass}`} />
            <span className="text-sm font-bold uppercase tracking-wider text-chatroom-text-primary">
              {role}
            </span>
            <span className={`text-[10px] font-bold uppercase tracking-wide ${statusColorClass}`}>
              {statusLabel}
            </span>
            {isStuck && (
              <span className="flex items-center gap-0.5 text-[10px] font-bold uppercase tracking-wide text-chatroom-status-warning">
                <AlertTriangle size={10} />
                STUCK
              </span>
            )}
          </div>
          {/* Agent type subtitle line */}
          <div className="flex items-center gap-1 pl-[18px]">
            {agentTypeDetails ? (
              <span
                className={`text-[10px] font-bold uppercase tracking-wide ${
                  teamConfig?.type === 'remote'
                    ? 'text-chatroom-status-info'
                    : 'text-chatroom-text-secondary'
                }`}
              >
                {agentTypeDetails.join(' · ')}
              </span>
            ) : (
              <span className="text-[10px] font-bold uppercase tracking-wide text-chatroom-status-warning">
                NOT REGISTERED
              </span>
            )}
          </div>
          {/* Last seen subtitle line */}
          <div className="pl-[18px]">
            <span className="text-[10px] font-bold uppercase tracking-wide text-chatroom-text-muted">
              Last seen: {formatLastSeen(lastSeenAt)}
            </span>
          </div>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          <CopyButton text={prompt} label="Copy Prompt" copiedLabel="Copied!" variant="compact" />
          {isExpanded ? (
            <ChevronUp size={14} className="text-chatroom-text-muted" />
          ) : (
            <ChevronDown size={14} className="text-chatroom-text-muted" />
          )}
        </div>
      </div>

      {/* Expanded Content - shown inline */}
      {isExpanded && (
        <div className="px-4 pb-4 space-y-3">
          {/* Resolved configuration details */}
          {teamConfig && (
            <div className="text-[11px] text-chatroom-text-muted bg-chatroom-bg-surface border border-chatroom-border p-3 space-y-1">
              <div className="font-bold uppercase tracking-wide text-chatroom-text-secondary text-[10px] mb-1.5">
                Agent Configuration
              </div>
              <div className="flex gap-2">
                <span className="text-chatroom-text-muted w-16 shrink-0">Type</span>
                <span className="text-chatroom-text-primary font-medium">
                  {teamConfig.type.toUpperCase()}
                </span>
              </div>
              {teamConfig.type === 'remote' && (
                <>
                  {teamConfig.agentHarness && (
                    <div className="flex gap-2">
                      <span className="text-chatroom-text-muted w-16 shrink-0">Harness</span>
                      <span className="text-chatroom-text-primary font-medium">
                        {teamConfig.agentHarness}
                      </span>
                    </div>
                  )}
                  {(machineHostname || teamConfig.machineId) && (
                    <div className="flex gap-2">
                      <span className="text-chatroom-text-muted w-16 shrink-0">Machine</span>
                      <span className="text-chatroom-text-primary font-medium">
                        {machineHostname || teamConfig.machineId}
                      </span>
                    </div>
                  )}
                  <div className="flex gap-2">
                    <span className="text-chatroom-text-muted w-16 shrink-0">Model</span>
                    <span
                      className={`font-medium ${teamConfig.model ? 'text-chatroom-text-primary' : 'text-chatroom-status-warning'}`}
                    >
                      {teamConfig.model || 'Not set'}
                    </span>
                  </div>
                  {teamConfig.workingDir && (
                    <div className="flex gap-2">
                      <span className="text-chatroom-text-muted w-16 shrink-0">Dir</span>
                      <span className="text-chatroom-text-primary font-medium font-mono text-[10px] truncate">
                        {teamConfig.workingDir}
                      </span>
                    </div>
                  )}
                </>
              )}
              {teamConfig.type === 'custom' && (
                <div className="text-chatroom-text-muted italic">
                  Manually started agent (custom)
                </div>
              )}
            </div>
          )}
          <AgentStatusBanner controls={controls} />
          <AgentConfigTabs
            activeTab={activeTab}
            onTabChange={setActiveTab}
            controls={controls}
            role={role}
            prompt={prompt}
            connectedMachines={connectedMachines}
            isLoadingMachines={isLoadingMachines}
            daemonStartCommand={daemonStartCommand}
            onViewPrompt={onViewPrompt}
          />
        </div>
      )}
    </div>
  );
});

// Unified Agent List Modal - shows ALL agents with inline config/controls
interface UnifiedAgentListModalProps {
  isOpen: boolean;
  onClose: () => void;
  agents: AgentWithStatus[];
  generatePrompt: (role: string) => string;
  chatroomId: string;
  onViewPrompt?: (role: string) => void;
}

const UnifiedAgentListModal = memo(function UnifiedAgentListModal({
  isOpen,
  onClose,
  agents,
  generatePrompt,
  chatroomId,
  onViewPrompt,
}: UnifiedAgentListModalProps) {
  const { isProductionUrl } = usePrompts();

  // Compute the full daemon start command with env var if needed
  const daemonStartCommand = useMemo(() => {
    if (isProductionUrl) {
      return 'chatroom machine daemon start';
    }
    const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL;
    return `CHATROOM_CONVEX_URL=${convexUrl} chatroom machine daemon start`;
  }, [isProductionUrl]);

  // Fetch machines and agent configs for all agents in one go
  const machinesResult = useSessionQuery(api.machines.listMachines, {}) as
    | { machines: MachineInfo[] }
    | undefined;

  const configsResult = useSessionQuery(api.machines.getAgentConfigs, {
    chatroomId: chatroomId as Id<'chatroom_rooms'>,
  }) as { configs: AgentConfig[] } | undefined;

  // Fetch team agent configs to show registration status
  const teamAgentConfigs = useSessionQuery(api.machines.getTeamAgentConfigs, {
    chatroomId: chatroomId as Id<'chatroom_rooms'>,
  }) as TeamAgentConfig[] | undefined;

  // Fetch user's saved agent preferences for pre-populating Remote tab defaults
  const agentPreferencesResult = useSessionQuery(api.machines.getAgentPreferences, {
    chatroomId: chatroomId as Id<'chatroom_rooms'>,
  }) as AgentPreference[] | undefined;

  const saveAgentPreference = useSessionMutation(api.machines.saveAgentPreference);

  const sendCommand = useSessionMutation(api.machines.sendCommand);

  const connectedMachines = useMemo(() => {
    if (!machinesResult?.machines) return [];
    return machinesResult.machines.filter((m) => m.daemonConnected);
  }, [machinesResult?.machines]);

  const agentConfigs = useMemo(() => {
    return configsResult?.configs || [];
  }, [configsResult?.configs]);

  const isLoadingMachines = machinesResult === undefined || configsResult === undefined;

  // Build a lookup map from teamAgentConfigs keyed by role (lowercase)
  const teamConfigMap = useMemo(() => {
    if (!teamAgentConfigs) return new Map<string, TeamAgentConfig>();
    return new Map(teamAgentConfigs.map((c) => [c.role.toLowerCase(), c]));
  }, [teamAgentConfigs]);

  // Build a lookup map from agentPreferences keyed by role (lowercase)
  const agentPreferenceMap = useMemo(() => {
    if (!agentPreferencesResult) return new Map<string, AgentPreference>();
    return new Map(agentPreferencesResult.map((p) => [p.role.toLowerCase(), p]));
  }, [agentPreferencesResult]);

  // Handler to save a preference to the backend
  const handleSavePreference = useCallback(
    (pref: AgentPreference) => {
      saveAgentPreference({
        chatroomId: chatroomId as Id<'chatroom_rooms'>,
        role: pref.role,
        machineId: pref.machineId,
        agentHarness: pref.agentHarness,
        model: pref.model,
        workingDir: pref.workingDir,
      }).catch((err) => {
        console.error('[AgentPanel] Failed to save agent preference:', err);
      });
    },
    [saveAgentPreference, chatroomId]
  );

  return (
    <FixedModal isOpen={isOpen} onClose={onClose}>
      <FixedModalContent>
        <FixedModalHeader onClose={onClose}>
          <FixedModalTitle>All Agents ({agents.length})</FixedModalTitle>
        </FixedModalHeader>
        <FixedModalBody>
          {agents.map(({ role, online, lastSeenAt, latestEventType, isStuck }) => (
            <InlineAgentCard
              key={role}
              role={role}
              online={online}
              lastSeenAt={lastSeenAt}
              latestEventType={latestEventType}
              isStuck={isStuck}
              prompt={generatePrompt(role)}
              chatroomId={chatroomId}
              connectedMachines={connectedMachines}
              agentConfigs={agentConfigs}
              isLoadingMachines={isLoadingMachines}
              daemonStartCommand={daemonStartCommand}
              sendCommand={sendCommand}
              onViewPrompt={onViewPrompt}
              teamConfig={teamConfigMap.get(role.toLowerCase())}
              agentPreference={agentPreferenceMap.get(role.toLowerCase())}
              onSavePreference={handleSavePreference}
            />
          ))}
        </FixedModalBody>
      </FixedModalContent>
    </FixedModal>
  );
});

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

  // Fetch latest event type for each role — event-driven status (not heartbeat strings)
  const latestEventsByRole = useSessionQuery(api.machines.getLatestAgentEventsForChatroom, {
    chatroomId: chatroomId as Id<'chatroom_rooms'>,
    roles: rolesToShow,
  }) as Record<string, string> | undefined;

  // Build participant map from lifecycle data
  const participantMap = useMemo(() => {
    if (!lifecycle?.participants) return new Map<string, ParticipantInfo>();
    return new Map(lifecycle.participants.map((p) => [p.role.toLowerCase(), p as ParticipantInfo]));
  }, [lifecycle?.participants]);

  // Categorize agents by presence for grouped display
  const categorizedAgents = useMemo(() => {
    const working: string[] = []; // online and actively working (shown individually at top)
    const online: string[] = []; // online and idle/waiting
    const offline: string[] = []; // not seen within threshold

    for (const role of rolesToShow) {
      const participant = participantMap.get(role.toLowerCase());
      const online_ = isOnline(participant?.lastSeenAt);
      const latestEventType = latestEventsByRole?.[role.toLowerCase()] ?? null;

      if (isWorkingFromEvent(online_, latestEventType)) {
        working.push(role);
      } else if (online_) {
        online.push(role);
      } else {
        offline.push(role);
      }
    }

    return { working, online, offline };
  }, [rolesToShow, participantMap, latestEventsByRole]);

  // Memoize prompt generation function
  const generatePrompt = useCallback(
    (role: string): string => {
      return getAgentPrompt(role) || '';
    },
    [getAgentPrompt]
  );

  // Build unified list of all agents with their presence
  const allAgentsWithStatus = useMemo(() => {
    return rolesToShow.map((role) => {
      const participant = participantMap.get(role.toLowerCase());
      return {
        role,
        online: isOnline(participant?.lastSeenAt),
        lastSeenAt: participant?.lastSeenAt,
        latestEventType: latestEventsByRole?.[role.toLowerCase()] ?? null,
        isStuck: participant?.isStuck,
      };
    });
  }, [rolesToShow, participantMap, latestEventsByRole]);

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

  // Helper to render an agent row in the sidebar (for working/active agents)
  const renderAgentRow = (role: string) => {
    const participant = participantMap.get(role.toLowerCase());
    const online_ = isOnline(participant?.lastSeenAt);
    const latestEventType = latestEventsByRole?.[role.toLowerCase()] ?? null;
    const working_ = isWorkingFromEvent(online_, latestEventType);
    const isStuck = participant?.isStuck === true;

    const indicatorClass = online_ ? 'bg-chatroom-status-success' : 'bg-chatroom-text-muted';
    const statusLabel = online_ ? eventTypeToStatusLabel(latestEventType) : 'OFFLINE';

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
              {formatLastSeen(participant?.lastSeenAt)}
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
        {/* Working Agents - always shown prominently at top */}
        {categorizedAgents.working.map(renderAgentRow)}

        {/* Online Agents - collapsed group that opens unified modal */}
        {categorizedAgents.online.length > 0 && (
          <CollapsedAgentGroup
            title="Online"
            agents={categorizedAgents.online}
            variant="online"
            onOpenModal={openAgentListModal}
          />
        )}

        {/* Offline Agents - collapsed group that opens unified modal */}
        {categorizedAgents.offline.length > 0 && (
          <CollapsedAgentGroup
            title="Offline"
            agents={categorizedAgents.offline}
            variant="offline"
            onOpenModal={openAgentListModal}
          />
        )}
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

