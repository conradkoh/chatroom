'use client';

import { api } from '@workspace/backend/convex/_generated/api';
import type { Id } from '@workspace/backend/convex/_generated/dataModel';
import { useSessionMutation, useSessionQuery } from 'convex-helpers/react/sessions';
import {
  ChevronRight,
  CheckCircle,
  AlertTriangle,
  Clock,
  RefreshCw,
  X,
  ChevronDown,
  ChevronUp,
} from 'lucide-react';
import React, { useState, useMemo, useCallback, memo, useEffect } from 'react';
import { createPortal } from 'react-dom';

import { useAgentControls, AgentConfigTabs, AgentStatusBanner } from './AgentConfigTabs';
import { ChatroomAgentDetailsModal } from './ChatroomAgentDetailsModal';
import { CopyButton } from './CopyButton';
import type { AgentTool, MachineInfo, AgentConfig } from '../types/machine';

import { usePrompts } from '@/contexts/PromptsContext';

// Participant info from readiness query - includes expiration data
interface ParticipantInfo {
  role: string;
  status: string;
  readyUntil?: number;
  isExpired: boolean;
}

// Team readiness data from backend - single source of truth
interface TeamReadiness {
  isReady: boolean;
  expectedRoles: string[];
  presentRoles?: string[]; // Optional - not all callers provide this
  missingRoles: string[];
  expiredRoles?: string[];
  participants?: ParticipantInfo[];
}

interface AgentPanelProps {
  chatroomId: string;
  teamRoles?: string[];
  readiness: TeamReadiness | null | undefined;
  onViewPrompt?: (role: string) => void;
  onReconnect?: () => void;
}

// Status indicator colors - now includes disconnected state
// ─── Status Utilities ────────────────────────────────────────────────

const STATUS_CONFIG: Record<string, { bg: string; text: string; label: string }> = {
  active: {
    bg: 'bg-chatroom-status-info',
    text: 'text-chatroom-status-info',
    label: 'WORKING',
  },
  waiting: {
    bg: 'bg-chatroom-status-success',
    text: 'text-chatroom-status-success',
    label: 'READY',
  },
  disconnected: {
    bg: 'bg-chatroom-status-error',
    text: 'text-chatroom-status-error',
    label: 'DISCONNECTED',
  },
  missing: {
    bg: 'bg-chatroom-text-muted',
    text: 'text-chatroom-status-warning',
    label: 'NOT JOINED',
  },
};

const DEFAULT_STATUS = {
  bg: 'bg-chatroom-text-muted',
  text: 'text-chatroom-status-warning',
  label: 'OFFLINE',
};

const getStatusConfig = (status: string) => STATUS_CONFIG[status] ?? DEFAULT_STATUS;

const getStatusClasses = (effectiveStatus: string) =>
  `w-2.5 h-2.5 flex-shrink-0 ${getStatusConfig(effectiveStatus).bg}`;

// Compute effective status accounting for expiration
const getEffectiveStatus = (
  role: string,
  participantMap: Map<string, ParticipantInfo>,
  expiredRolesSet: Set<string>
): { status: string; isExpired: boolean } => {
  const participant = participantMap.get(role.toLowerCase());
  if (!participant) {
    return { status: 'missing', isExpired: false };
  }
  // Check if this role is in the expired set
  if (expiredRolesSet.has(role.toLowerCase())) {
    return { status: 'disconnected', isExpired: true };
  }
  return { status: participant.status, isExpired: false };
};

// Collapsed Agent Group Component - shows a collapsed row that opens the unified modal
interface CollapsedAgentGroupProps {
  title: string;
  agents: string[];
  variant: 'ready' | 'offline';
  onOpenModal: () => void;
}

const CollapsedAgentGroup = memo(function CollapsedAgentGroup({
  title,
  agents,
  variant,
  onOpenModal,
}: CollapsedAgentGroupProps) {
  // Map variants to status keys so we reuse the shared STATUS_CONFIG colors
  const variantStatusMap: Record<CollapsedAgentGroupProps['variant'], string> = {
    ready: 'waiting',
    offline: 'missing',
  };
  const statusConfig = getStatusConfig(variantStatusMap[variant]);
  const classes = { indicator: statusConfig.bg };

  return (
    <div className="border-b border-border last:border-b-0">
      {/* Clickable Header - opens unified modal */}
      <div
        className="flex items-center gap-3 p-3 cursor-pointer transition-colors hover:bg-accent/50"
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
        <div className={`w-2.5 h-2.5 flex-shrink-0 ${classes.indicator}`} />
        {/* Group Info */}
        <div className="flex-1 min-w-0">
          <div className="text-xs font-bold uppercase tracking-wider text-foreground">
            {title}
            <span className="ml-1.5 text-muted-foreground">({agents.length})</span>
          </div>
          <div className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground truncate">
            {agents.map((r) => r.toUpperCase()).join(', ')}
          </div>
        </div>
        {/* View More Indicator */}
        <ChevronRight className="h-4 w-4 text-muted-foreground" />
      </div>
    </div>
  );
});

// Agent info with status for the unified modal
interface AgentWithStatus {
  role: string;
  effectiveStatus: string;
}

// Types and constants imported from ../types/machine

// Inline Agent Card - shows agent config, prompt, and controls directly in the modal
interface InlineAgentCardProps {
  role: string;
  effectiveStatus: string;
  prompt: string;
  chatroomId: string;
  connectedMachines: MachineInfo[];
  agentConfigs: AgentConfig[];
  isLoadingMachines: boolean;
  daemonStartCommand: string;
  sendCommand: (args: {
    machineId: string;
    type: string;
    payload: {
      chatroomId: Id<'chatroom_rooms'>;
      role: string;
      model?: string;
      agentTool?: AgentTool;
      workingDir?: string;
    };
  }) => Promise<unknown>;
  onViewPrompt?: (role: string) => void;
  /** Saved preferences for default selections */
  preferences?: {
    machineId?: string;
    toolByRole?: Record<string, string>;
    modelByRole?: Record<string, string>;
  } | null;
  /** Callback to save preferences when starting an agent */
  onSavePreferences?: (role: string, machineId: string, tool: string, model?: string) => void;
}

const InlineAgentCard = memo(function InlineAgentCard({
  role,
  effectiveStatus,
  prompt,
  chatroomId,
  connectedMachines,
  agentConfigs,
  isLoadingMachines,
  daemonStartCommand,
  sendCommand,
  onViewPrompt,
  preferences,
  onSavePreferences,
}: InlineAgentCardProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const [activeTab, setActiveTab] = useState<'remote' | 'custom'>('remote');

  const controls = useAgentControls({
    role,
    chatroomId,
    connectedMachines,
    agentConfigs,
    sendCommand,
    preferences,
    onSavePreferences,
  });

  const statusInfo = getStatusConfig(effectiveStatus);
  const statusLabel = statusInfo.label;
  const statusClass = statusInfo.bg;
  const statusColorClass = statusInfo.text;

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
        <div className="flex items-center gap-2 min-w-0">
          <div className={`w-2.5 h-2.5 flex-shrink-0 ${statusClass}`} />
          <span className="text-sm font-bold uppercase tracking-wider text-chatroom-text-primary">
            {role}
          </span>
          <span className={`text-[10px] font-bold uppercase tracking-wide ${statusColorClass}`}>
            {statusLabel}
          </span>
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
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const machinesApi = api as any;
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
  const machinesResult = useSessionQuery(machinesApi.machines.listMachines, {}) as
    | { machines: MachineInfo[] }
    | undefined;

  const configsResult = useSessionQuery(machinesApi.machines.getAgentConfigs, {
    chatroomId: chatroomId as Id<'chatroom_rooms'>,
  }) as { configs: AgentConfig[] } | undefined;

  const sendCommand = useSessionMutation(machinesApi.machines.sendCommand);
  const updatePreferences = useSessionMutation(machinesApi.machines.updateAgentPreferences);

  // Load agent preferences for this chatroom
  const preferencesResult = useSessionQuery(machinesApi.machines.getAgentPreferences, {
    chatroomId: chatroomId as Id<'chatroom_rooms'>,
  }) as
    | {
        machineId?: string;
        toolByRole?: Record<string, string>;
        modelByRole?: Record<string, string>;
      }
    | null
    | undefined;

  // Save preferences callback (called on agent start)
  const savePreferences = useCallback(
    async (role: string, machineId: string, tool: string, model?: string) => {
      try {
        await updatePreferences({
          chatroomId: chatroomId as Id<'chatroom_rooms'>,
          machineId,
          role,
          tool,
          model,
        });
      } catch {
        // Non-critical — don't block agent start if preferences fail to save
      }
    },
    [updatePreferences, chatroomId]
  );

  const connectedMachines = useMemo(() => {
    if (!machinesResult?.machines) return [];
    return machinesResult.machines.filter((m) => m.daemonConnected);
  }, [machinesResult?.machines]);

  const agentConfigs = useMemo(() => {
    return configsResult?.configs || [];
  }, [configsResult?.configs]);

  const isLoadingMachines = machinesResult === undefined || configsResult === undefined;

  // Handle backdrop click
  const handleBackdropClick = useCallback(
    (e: React.MouseEvent) => {
      if (e.target === e.currentTarget) {
        onClose();
      }
    },
    [onClose]
  );

  // Handle escape key
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  // Lock body scroll when modal is open
  useEffect(() => {
    if (isOpen) {
      const originalOverflow = document.body.style.overflow;
      document.body.style.overflow = 'hidden';
      return () => {
        document.body.style.overflow = originalOverflow;
      };
    }
  }, [isOpen]);

  if (!isOpen) return null;
  if (typeof document === 'undefined') return null;

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4"
      onClick={handleBackdropClick}
    >
      <div className="chatroom-root w-full max-w-lg max-h-[85vh] flex flex-col bg-chatroom-bg-primary border-2 border-chatroom-border-strong overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b-2 border-chatroom-border-strong bg-chatroom-bg-surface">
          <h2 className="text-sm font-bold uppercase tracking-wider text-chatroom-text-primary">
            All Agents ({agents.length})
          </h2>
          <button
            onClick={onClose}
            className="w-8 h-8 flex items-center justify-center text-chatroom-text-muted hover:text-chatroom-text-primary hover:bg-chatroom-bg-hover transition-colors"
          >
            <X size={18} />
          </button>
        </div>

        {/* Agent List - inline cards for each agent */}
        <div className="flex-1 overflow-y-auto">
          {agents.map(({ role, effectiveStatus }) => (
            <InlineAgentCard
              key={role}
              role={role}
              effectiveStatus={effectiveStatus}
              prompt={generatePrompt(role)}
              chatroomId={chatroomId}
              connectedMachines={connectedMachines}
              agentConfigs={agentConfigs}
              isLoadingMachines={isLoadingMachines}
              daemonStartCommand={daemonStartCommand}
              sendCommand={sendCommand}
              onViewPrompt={onViewPrompt}
              preferences={preferencesResult}
              onSavePreferences={savePreferences}
            />
          ))}
        </div>
      </div>
    </div>,
    document.body
  );
});

export const AgentPanel = memo(function AgentPanel({
  chatroomId,
  teamRoles = [],
  readiness,
  onViewPrompt,
  onReconnect,
}: AgentPanelProps) {
  const [selectedAgent, setSelectedAgent] = useState<string | null>(null);
  const [selectedAgentStatus, setSelectedAgentStatus] = useState<string | null>(null);
  const [isAgentListModalOpen, setIsAgentListModalOpen] = useState(false);
  const { getAgentPrompt } = usePrompts();

  // Build participant map from readiness data
  const participantMap = useMemo(() => {
    if (!readiness?.participants) return new Map<string, ParticipantInfo>();
    return new Map(readiness.participants.map((p) => [p.role.toLowerCase(), p]));
  }, [readiness?.participants]);

  // Build expired roles set for O(1) lookup
  const expiredRolesSet = useMemo(() => {
    if (!readiness?.expiredRoles) return new Set<string>();
    return new Set(readiness.expiredRoles.map((r) => r.toLowerCase()));
  }, [readiness?.expiredRoles]);

  // Determine which roles to show (memoized)
  const rolesToShow = useMemo(
    () => (teamRoles.length > 0 ? teamRoles : readiness?.expectedRoles || []),
    [teamRoles, readiness?.expectedRoles]
  );

  // Phase 1: Categorize agents by status for grouped display
  const categorizedAgents = useMemo(() => {
    const active: string[] = [];
    const ready: string[] = [];
    const other: string[] = [];

    for (const role of rolesToShow) {
      const { status } = getEffectiveStatus(role, participantMap, expiredRolesSet);
      if (status === 'active') {
        active.push(role);
      } else if (status === 'waiting') {
        ready.push(role);
      } else {
        // disconnected, missing, or any other status
        other.push(role);
      }
    }

    return { active, ready, other };
  }, [rolesToShow, participantMap, expiredRolesSet]);

  // Memoize prompt generation function
  const generatePrompt = useCallback(
    (role: string): string => {
      return getAgentPrompt(role) || '';
    },
    [getAgentPrompt]
  );

  // Build unified list of all agents with their status
  const allAgentsWithStatus = useMemo(() => {
    return rolesToShow.map((role) => ({
      role,
      effectiveStatus: getEffectiveStatus(role, participantMap, expiredRolesSet).status,
    }));
  }, [rolesToShow, participantMap, expiredRolesSet]);

  // Open unified agent list modal
  const openAgentListModal = useCallback(() => {
    setIsAgentListModalOpen(true);
  }, []);

  // Close unified agent list modal
  const closeAgentListModal = useCallback(() => {
    setIsAgentListModalOpen(false);
  }, []);

  // Open agent modal directly (for individual agent rows in sidebar)
  const openAgentModal = useCallback(
    (role: string) => {
      const { status } = getEffectiveStatus(role, participantMap, expiredRolesSet);
      setSelectedAgent(role);
      setSelectedAgentStatus(status);
    },
    [participantMap, expiredRolesSet]
  );

  // Close agent modal
  const closeAgentModal = useCallback(() => {
    setSelectedAgent(null);
    setSelectedAgentStatus(null);
  }, []);

  // Compute team status
  const hasExpiredRoles = readiness?.expiredRoles && readiness.expiredRoles.length > 0;
  const isDisconnected = !readiness?.isReady && hasExpiredRoles;

  // Loading state
  if (readiness === undefined) {
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
  if (readiness === null) {
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
    const { status: effectiveStatus } = getEffectiveStatus(role, participantMap, expiredRolesSet);

    const statusLabel = getStatusConfig(effectiveStatus).label;

    const isActive = effectiveStatus === 'active';
    const isDisconnectedAgent = effectiveStatus === 'disconnected';

    return (
      <div key={role} className="border-b border-chatroom-border last:border-b-0">
        <div
          className={`flex items-center gap-3 p-3 cursor-pointer transition-all duration-100 hover:bg-chatroom-bg-hover ${isActive ? 'bg-chatroom-status-info/5' : ''} ${isDisconnectedAgent ? 'bg-chatroom-status-error/5' : ''}`}
          role="button"
          tabIndex={0}
          aria-label={`${role}: ${statusLabel}. Click to view details.`}
          onClick={() => openAgentModal(role)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              openAgentModal(role);
            }
          }}
        >
          {/* Status Indicator */}
          <div
            className={getStatusClasses(effectiveStatus)}
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
                isActive
                  ? 'text-chatroom-status-info animate-pulse'
                  : isDisconnectedAgent
                    ? 'text-chatroom-status-error'
                    : 'text-chatroom-text-muted'
              }`}
            >
              {statusLabel}
            </div>
          </div>
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
      {/* Header with status indicator */}
      <div className="flex items-center justify-between p-4 border-b-2 border-chatroom-border">
        <div className="text-[10px] font-bold uppercase tracking-widest text-chatroom-text-muted">
          Agents
        </div>
        <div className="flex items-center gap-2">
          <div
            className={`${
              readiness.isReady
                ? 'text-chatroom-status-success'
                : isDisconnected
                  ? 'text-chatroom-status-error'
                  : 'text-chatroom-status-warning'
            }`}
          >
            {readiness.isReady ? (
              <CheckCircle size={12} />
            ) : isDisconnected ? (
              <AlertTriangle size={12} />
            ) : (
              <Clock size={12} />
            )}
          </div>
          <div
            className={`text-[10px] font-bold uppercase tracking-wide ${
              readiness.isReady
                ? 'text-chatroom-status-success'
                : isDisconnected
                  ? 'text-chatroom-status-error'
                  : 'text-chatroom-status-warning'
            }`}
          >
            {readiness.isReady ? 'Ready' : isDisconnected ? 'Disconnected' : 'Waiting'}
          </div>
        </div>
      </div>
      {/* Fixed height container for 2 rows to prevent layout jumping */}
      <div className="overflow-y-auto h-[108px]">
        {/* Active Agents - always shown prominently at top */}
        {categorizedAgents.active.map(renderAgentRow)}

        {/* Ready Agents - collapsed group that opens unified modal */}
        {categorizedAgents.ready.length > 0 && (
          <CollapsedAgentGroup
            title="Ready"
            agents={categorizedAgents.ready}
            variant="ready"
            onOpenModal={openAgentListModal}
          />
        )}

        {/* Other Agents (disconnected/missing) - collapsed group that opens unified modal */}
        {categorizedAgents.other.length > 0 && (
          <CollapsedAgentGroup
            title="Offline"
            agents={categorizedAgents.other}
            variant="offline"
            onOpenModal={openAgentListModal}
          />
        )}
      </div>

      {/* Reconnect footer - only shown when agents are disconnected */}
      {isDisconnected && (
        <div className="p-3 bg-chatroom-bg-tertiary border-t border-chatroom-border">
          <div className="flex items-center justify-between">
            <div className="text-[10px] text-chatroom-text-muted">
              {`Disconnected: ${readiness.expiredRoles?.join(', ')}`}
            </div>
            {onReconnect && (
              <button
                onClick={onReconnect}
                className="flex items-center gap-1 px-2 py-1 border border-chatroom-status-info text-chatroom-status-info text-[10px] font-bold uppercase tracking-wide hover:bg-chatroom-status-info/10 transition-all duration-100"
              >
                <RefreshCw size={10} />
                Reconnect
              </button>
            )}
          </div>
        </div>
      )}

      {/* Waiting footer - only shown when waiting for agents */}
      {!readiness.isReady && !isDisconnected && (
        <div className="p-3 bg-chatroom-bg-tertiary border-t border-chatroom-border">
          <div className="text-[10px] text-chatroom-text-muted">
            {`Missing: ${readiness.missingRoles.join(', ')}`}
          </div>
        </div>
      )}

      {/* Unified Agent List Modal - shows ALL agents with inline config/controls */}
      <UnifiedAgentListModal
        isOpen={isAgentListModalOpen}
        onClose={closeAgentListModal}
        agents={allAgentsWithStatus}
        generatePrompt={generatePrompt}
        chatroomId={chatroomId}
        onViewPrompt={onViewPrompt}
      />

      {/* Agent Details Modal - for direct agent row clicks in sidebar */}
      {selectedAgent && selectedAgentStatus && (
        <ChatroomAgentDetailsModal
          isOpen={true}
          onClose={closeAgentModal}
          chatroomId={chatroomId}
          role={selectedAgent}
          effectiveStatus={selectedAgentStatus}
          onViewPrompt={onViewPrompt}
        />
      )}
    </div>
  );
});
