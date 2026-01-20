'use client';

import { ChevronRight, CheckCircle, AlertTriangle, Clock, RefreshCw, X } from 'lucide-react';
import React, { useState, useMemo, useCallback, memo, useEffect } from 'react';

import { CopyButton } from './CopyButton';
import { generateAgentPrompt } from '../prompts/generator';

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
  teamName?: string;
  teamRoles?: string[];
  teamEntryPoint?: string;
  readiness: TeamReadiness | null | undefined;
  onViewPrompt?: (role: string) => void;
  onReconnect?: () => void;
}

// Status indicator colors - now includes disconnected state
const getStatusClasses = (effectiveStatus: string) => {
  const base = 'w-2.5 h-2.5 flex-shrink-0';
  switch (effectiveStatus) {
    case 'active':
      return `${base} bg-chatroom-status-info`;
    case 'waiting':
      return `${base} bg-chatroom-status-success`;
    case 'disconnected':
      return `${base} bg-chatroom-status-error`;
    default:
      return `${base} bg-chatroom-text-muted`;
  }
};

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

// Collapsed Agent Group Component - now opens a custom modal instead of ShadCN Dialog
interface CollapsedAgentGroupProps {
  title: string;
  agents: string[];
  variant: 'ready' | 'offline';
  generatePrompt: (role: string) => string;
  onViewPrompt?: (role: string) => void;
}

const CollapsedAgentGroup = memo(function CollapsedAgentGroup({
  title,
  agents,
  variant,
  generatePrompt,
  onViewPrompt,
}: CollapsedAgentGroupProps) {
  const [isModalOpen, setIsModalOpen] = useState(false);

  const variantClasses = {
    ready: {
      indicator: 'bg-chatroom-status-success',
      text: 'text-chatroom-status-success',
    },
    offline: {
      indicator: 'bg-chatroom-status-warning',
      text: 'text-chatroom-status-warning',
    },
  };

  const classes = variantClasses[variant];

  // Handle escape key to close modal
  useEffect(() => {
    if (isModalOpen) {
      const handleKeyDown = (e: KeyboardEvent) => {
        if (e.key === 'Escape') {
          setIsModalOpen(false);
        }
      };
      document.addEventListener('keydown', handleKeyDown);
      return () => document.removeEventListener('keydown', handleKeyDown);
    }
  }, [isModalOpen]);

  // Handle backdrop click
  const handleBackdropClick = useCallback((e: React.MouseEvent) => {
    if (e.target === e.currentTarget) {
      setIsModalOpen(false);
    }
  }, []);

  return (
    <>
      <div className="border-b border-chatroom-border last:border-b-0">
        <div
          className="flex items-center gap-3 p-3 cursor-pointer transition-all duration-100 hover:bg-chatroom-bg-hover"
          role="button"
          tabIndex={0}
          aria-label={`${title} agents (${agents.length}). Click to view details.`}
          onClick={() => setIsModalOpen(true)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              setIsModalOpen(true);
            }
          }}
        >
          {/* Status Indicator */}
          <div className={`w-2.5 h-2.5 flex-shrink-0 ${classes.indicator}`} />
          {/* Group Info */}
          <div className="flex-1 min-w-0">
            <div className="text-xs font-bold uppercase tracking-wide text-chatroom-text-primary">
              {title}
              <span className="ml-1.5 text-chatroom-text-muted">({agents.length})</span>
            </div>
            <div className={`text-[10px] font-bold uppercase tracking-wide ${classes.text}`}>
              {agents.map((r) => r.toUpperCase()).join(', ')}
            </div>
          </div>
          {/* View More Indicator */}
          <div className="text-chatroom-text-muted">
            <ChevronRight size={14} />
          </div>
        </div>
      </div>

      {/* Custom Agent Group Modal - matches TaskDetailModal pattern */}
      {isModalOpen && (
        <>
          {/* Backdrop */}
          <div
            className="fixed inset-0 bg-black/60 z-[60] backdrop-blur-sm"
            onClick={handleBackdropClick}
          />

          {/* Modal Content */}
          <div className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 max-w-sm w-[90%] max-h-[70vh] bg-chatroom-bg-primary border-2 border-chatroom-border-strong z-[70] flex flex-col animate-in fade-in zoom-in-95 duration-200">
            {/* Header */}
            <div className="flex justify-between items-center p-4 border-b-2 border-chatroom-border-strong bg-chatroom-bg-surface flex-shrink-0">
              <div className="flex items-center gap-2">
                <div className={`w-2.5 h-2.5 flex-shrink-0 ${classes.indicator}`} />
                <span className="text-[10px] font-bold uppercase tracking-widest text-chatroom-text-primary">
                  {title} Agents ({agents.length})
                </span>
              </div>
              <button
                className="bg-transparent border-2 border-chatroom-border text-chatroom-text-secondary w-9 h-9 flex items-center justify-center cursor-pointer transition-all duration-100 hover:bg-chatroom-bg-hover hover:border-chatroom-border-strong hover:text-chatroom-text-primary"
                onClick={() => setIsModalOpen(false)}
                aria-label="Close"
              >
                <X size={20} />
              </button>
            </div>

            {/* Content */}
            <div className="flex-1 overflow-y-auto overflow-x-hidden">
              {agents.map((role) => {
                const prompt = generatePrompt(role);
                const preview = prompt.split('\n')[0]?.substring(0, 40) + '...';

                return (
                  <div
                    key={role}
                    className="border-b border-chatroom-border last:border-b-0 p-4 hover:bg-chatroom-bg-hover transition-colors"
                  >
                    <div className="flex items-center justify-between gap-2 mb-2">
                      <div className="text-sm font-bold uppercase tracking-wide text-chatroom-text-primary truncate">
                        {role}
                      </div>
                      <CopyButton text={prompt} label="Copy Prompt" copiedLabel="Copied!" />
                    </div>
                    <div
                      className="text-xs text-chatroom-text-muted font-mono truncate cursor-pointer hover:text-chatroom-text-secondary"
                      onClick={() => {
                        onViewPrompt?.(role);
                        setIsModalOpen(false);
                      }}
                      title="Click to view full prompt"
                    >
                      {preview}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </>
      )}
    </>
  );
});

// Single Agent Modal Component - shows prompt and copy button for individual agents
interface SingleAgentModalProps {
  role: string;
  effectiveStatus: string;
  prompt: string;
  isOpen: boolean;
  onClose: () => void;
  onViewPrompt?: (role: string) => void;
}

const SingleAgentModal = memo(function SingleAgentModal({
  role,
  effectiveStatus,
  prompt,
  isOpen,
  onClose,
  onViewPrompt,
}: SingleAgentModalProps) {
  // Handle escape key to close modal
  useEffect(() => {
    if (isOpen) {
      const handleKeyDown = (e: KeyboardEvent) => {
        if (e.key === 'Escape') {
          onClose();
        }
      };
      document.addEventListener('keydown', handleKeyDown);
      return () => document.removeEventListener('keydown', handleKeyDown);
    }
  }, [isOpen, onClose]);

  // Handle backdrop click
  const handleBackdropClick = useCallback(
    (e: React.MouseEvent) => {
      if (e.target === e.currentTarget) {
        onClose();
      }
    },
    [onClose]
  );

  if (!isOpen) return null;

  const statusLabel =
    effectiveStatus === 'missing'
      ? 'NOT JOINED'
      : effectiveStatus === 'disconnected'
        ? 'DISCONNECTED'
        : effectiveStatus === 'waiting'
          ? 'READY'
          : effectiveStatus === 'active'
            ? 'WORKING'
            : 'IDLE';

  const indicatorClass =
    effectiveStatus === 'active'
      ? 'bg-chatroom-status-info'
      : effectiveStatus === 'waiting'
        ? 'bg-chatroom-status-success'
        : effectiveStatus === 'disconnected'
          ? 'bg-chatroom-status-error'
          : 'bg-chatroom-text-muted';

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/60 z-[60] backdrop-blur-sm"
        onClick={handleBackdropClick}
      />

      {/* Modal Content */}
      <div className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 max-w-sm w-[90%] max-h-[70vh] bg-chatroom-bg-primary border-2 border-chatroom-border-strong z-[70] flex flex-col animate-in fade-in zoom-in-95 duration-200">
        {/* Header */}
        <div className="flex justify-between items-center p-4 border-b-2 border-chatroom-border-strong bg-chatroom-bg-surface flex-shrink-0">
          <div className="flex items-center gap-2">
            <div className={`w-2.5 h-2.5 flex-shrink-0 ${indicatorClass}`} />
            <span className="text-[10px] font-bold uppercase tracking-widest text-chatroom-text-primary">
              {role.toUpperCase()} - {statusLabel}
            </span>
          </div>
          <button
            className="bg-transparent border-2 border-chatroom-border text-chatroom-text-secondary w-9 h-9 flex items-center justify-center cursor-pointer transition-all duration-100 hover:bg-chatroom-bg-hover hover:border-chatroom-border-strong hover:text-chatroom-text-primary"
            onClick={onClose}
            aria-label="Close"
          >
            <X size={20} />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto overflow-x-hidden p-4">
          <div className="flex items-center justify-between gap-2 mb-3">
            <div className="text-sm font-bold uppercase tracking-wide text-chatroom-text-primary">
              Agent Prompt
            </div>
            <CopyButton text={prompt} label="Copy Prompt" copiedLabel="Copied!" />
          </div>
          <div
            className="text-xs text-chatroom-text-muted font-mono whitespace-pre-wrap break-words bg-chatroom-bg-tertiary p-3 max-h-[40vh] overflow-y-auto cursor-pointer hover:text-chatroom-text-secondary"
            onClick={() => {
              onViewPrompt?.(role);
              onClose();
            }}
            title="Click to view full prompt in viewer"
          >
            {prompt.length > 500 ? prompt.substring(0, 500) + '...' : prompt}
          </div>
        </div>
      </div>
    </>
  );
});

export const AgentPanel = memo(function AgentPanel({
  chatroomId,
  teamName = 'Team',
  teamRoles = [],
  teamEntryPoint,
  readiness,
  onViewPrompt,
  onReconnect,
}: AgentPanelProps) {
  const [selectedAgent, setSelectedAgent] = useState<string | null>(null);

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
      return generateAgentPrompt({
        chatroomId,
        role,
        teamName,
        teamRoles,
        teamEntryPoint,
        convexUrl: process.env.NEXT_PUBLIC_CONVEX_URL,
      });
    },
    [chatroomId, teamName, teamRoles, teamEntryPoint]
  );

  // Open agent modal
  const openAgentModal = useCallback((role: string) => {
    setSelectedAgent(role);
  }, []);

  // Close agent modal
  const closeAgentModal = useCallback(() => {
    setSelectedAgent(null);
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

  // Helper to render an agent row
  const renderAgentRow = (role: string) => {
    const { status: effectiveStatus } = getEffectiveStatus(role, participantMap, expiredRolesSet);

    const statusLabel =
      effectiveStatus === 'missing'
        ? 'NOT JOINED'
        : effectiveStatus === 'disconnected'
          ? 'DISCONNECTED'
          : effectiveStatus === 'waiting'
            ? 'READY'
            : effectiveStatus === 'active'
              ? 'WORKING'
              : 'IDLE';

    const isActive = effectiveStatus === 'active';
    const isDisconnectedAgent = effectiveStatus === 'disconnected';

    return (
      <div key={role} className="border-b border-chatroom-border last:border-b-0">
        <div
          className={`flex items-center gap-3 p-3 cursor-pointer transition-all duration-100 hover:bg-chatroom-bg-hover ${isActive ? 'bg-chatroom-status-info/5' : ''} ${isDisconnectedAgent ? 'bg-chatroom-status-error/5' : ''}`}
          role="button"
          tabIndex={0}
          aria-label={`${role}: ${statusLabel}. Click to view prompt.`}
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

        {/* Ready Agents - collapsed group with dialog */}
        {categorizedAgents.ready.length > 0 && (
          <CollapsedAgentGroup
            title="Ready"
            agents={categorizedAgents.ready}
            variant="ready"
            generatePrompt={generatePrompt}
            onViewPrompt={onViewPrompt}
          />
        )}

        {/* Other Agents (disconnected/missing) - collapsed group with dialog */}
        {categorizedAgents.other.length > 0 && (
          <CollapsedAgentGroup
            title="Offline"
            agents={categorizedAgents.other}
            variant="offline"
            generatePrompt={generatePrompt}
            onViewPrompt={onViewPrompt}
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

      {/* Single Agent Modal */}
      {selectedAgent && (
        <SingleAgentModal
          role={selectedAgent}
          effectiveStatus={
            getEffectiveStatus(selectedAgent, participantMap, expiredRolesSet).status
          }
          prompt={generatePrompt(selectedAgent)}
          isOpen={true}
          onClose={closeAgentModal}
          onViewPrompt={onViewPrompt}
        />
      )}
    </div>
  );
});
