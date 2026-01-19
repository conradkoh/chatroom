'use client';

import { ChevronRight, CheckCircle, AlertTriangle, Clock, RefreshCw } from 'lucide-react';
import React, { useState, useMemo, useCallback, memo } from 'react';

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

// Collapsed Agent Group Component
interface CollapsedAgentGroupProps {
  title: string;
  agents: string[];
  variant: 'ready' | 'offline';
  renderAgent: (role: string) => React.ReactNode;
}

const CollapsedAgentGroup = memo(function CollapsedAgentGroup({
  title,
  agents,
  variant,
  renderAgent,
}: CollapsedAgentGroupProps) {
  const [isExpanded, setIsExpanded] = useState(false);

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

  return (
    <div className="border-b border-chatroom-border last:border-b-0">
      <div
        className="flex items-center gap-3 p-3 cursor-pointer transition-all duration-100 hover:bg-chatroom-bg-hover"
        role="button"
        tabIndex={0}
        aria-expanded={isExpanded}
        aria-label={`${title} agents (${agents.length}). Click to ${isExpanded ? 'collapse' : 'expand'}.`}
        onClick={() => setIsExpanded(!isExpanded)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            setIsExpanded(!isExpanded);
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
        {/* Expand Indicator */}
        <div
          className={`text-chatroom-text-muted transition-transform duration-100 ${isExpanded ? 'rotate-90' : ''}`}
        >
          <ChevronRight size={14} />
        </div>
      </div>

      {/* Expanded Agents */}
      {isExpanded && <div className="pl-4 bg-chatroom-bg-tertiary">{agents.map(renderAgent)}</div>}
    </div>
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
  const [expandedRole, setExpandedRole] = useState<string | null>(null);

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
      });
    },
    [chatroomId, teamName, teamRoles, teamEntryPoint]
  );

  // Memoize preview function
  const getPromptPreview = useCallback((prompt: string): string => {
    const firstLine = prompt.split('\n')[0] || '';
    if (firstLine.length > 50) {
      return firstLine.substring(0, 50) + '...';
    }
    return firstLine;
  }, []);

  const toggleExpanded = useCallback((role: string) => {
    setExpandedRole((prev) => (prev === role ? null : role));
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
    const prompt = generatePrompt(role);
    const preview = getPromptPreview(prompt);
    const isExpanded = expandedRole === role;

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
          className={`flex items-center gap-3 p-3 cursor-pointer transition-all duration-100 hover:bg-chatroom-bg-hover ${isActive ? 'bg-chatroom-status-info/5' : ''} ${isDisconnectedAgent ? 'bg-chatroom-status-error/5' : ''} ${isExpanded ? 'bg-chatroom-bg-tertiary' : ''}`}
          role="button"
          tabIndex={0}
          aria-expanded={isExpanded}
          aria-label={`${role}: ${statusLabel}. Click to ${isExpanded ? 'collapse' : 'expand'} options.`}
          onClick={() => toggleExpanded(role)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              toggleExpanded(role);
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
          {/* Expand Indicator */}
          <div
            className={`text-chatroom-text-muted transition-transform duration-100 ${isExpanded ? 'rotate-90' : ''}`}
          >
            <ChevronRight size={14} />
          </div>
        </div>

        {/* Expanded Prompt Row */}
        {isExpanded && (
          <div className="p-3 pt-0 flex items-center gap-2 bg-chatroom-bg-tertiary">
            <div
              className="flex-1 px-2 py-1 bg-chatroom-bg-primary text-chatroom-text-muted text-xs truncate cursor-pointer hover:text-chatroom-text-secondary"
              onClick={(e) => {
                e.stopPropagation();
                onViewPrompt?.(role);
              }}
              title="Click to view full prompt"
            >
              <span className="font-mono">{preview}</span>
            </div>
            <CopyButton text={prompt} label="Copy" copiedLabel="Copied" />
          </div>
        )}
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
      <div className="overflow-y-auto">
        {/* Active Agents - always shown prominently at top */}
        {categorizedAgents.active.map(renderAgentRow)}

        {/* Ready Agents - collapsed group */}
        {categorizedAgents.ready.length > 0 && (
          <CollapsedAgentGroup
            title="Ready"
            agents={categorizedAgents.ready}
            variant="ready"
            renderAgent={renderAgentRow}
          />
        )}

        {/* Other Agents (disconnected/missing) - collapsed group */}
        {categorizedAgents.other.length > 0 && (
          <CollapsedAgentGroup
            title="Offline"
            agents={categorizedAgents.other}
            variant="offline"
            renderAgent={renderAgentRow}
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
    </div>
  );
});
