'use client';

import { ChevronRight, CheckCircle, AlertTriangle, Clock, RefreshCw } from 'lucide-react';
import React, { useState, useMemo, useCallback, memo } from 'react';

import { CopyButton } from './CopyButton';

import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { ScrollArea } from '@/components/ui/scroll-area';
import { generateAgentPrompt } from '@/lib/prompts';

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

// Collapsed Agent Group Component - uses ShadCN Dialog
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
      indicator: 'bg-green-500 dark:bg-green-400',
      badge: 'default' as const,
    },
    offline: {
      indicator: 'bg-amber-500 dark:bg-amber-400',
      badge: 'secondary' as const,
    },
  };

  const classes = variantClasses[variant];

  return (
    <>
      <div className="border-b border-border last:border-b-0">
        <div
          className="flex items-center gap-3 p-3 cursor-pointer transition-colors hover:bg-accent/50"
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

      <Dialog open={isModalOpen} onOpenChange={setIsModalOpen}>
        <DialogContent className="max-w-sm max-h-[70vh] flex flex-col gap-0 p-0">
          <DialogHeader className="px-4 py-3 border-b">
            <div className="flex items-center gap-2">
              <div className={`w-2.5 h-2.5 ${classes.indicator}`} />
              <DialogTitle className="text-sm font-bold uppercase tracking-wider">
                {title} Agents ({agents.length})
              </DialogTitle>
            </div>
          </DialogHeader>

          <ScrollArea className="flex-1">
            {agents.map((role) => {
              const prompt = generatePrompt(role);
              const preview = prompt.split('\n')[0]?.substring(0, 40) + '...';

              return (
                <div
                  key={role}
                  className="border-b border-border last:border-b-0 p-4 hover:bg-accent/50 transition-colors"
                >
                  <div className="flex items-center justify-between gap-2 mb-2">
                    <span className="text-sm font-bold uppercase tracking-wider text-foreground truncate">
                      {role}
                    </span>
                    <CopyButton text={prompt} label="Copy Prompt" copiedLabel="Copied!" />
                  </div>
                  <button
                    className="text-xs text-muted-foreground font-mono truncate w-full text-left hover:text-foreground transition-colors"
                    onClick={() => {
                      onViewPrompt?.(role);
                      setIsModalOpen(false);
                    }}
                    title="Click to view full prompt"
                  >
                    {preview}
                  </button>
                </div>
              );
            })}
          </ScrollArea>
        </DialogContent>
      </Dialog>
    </>
  );
});

// Single Agent Modal Component - uses ShadCN Dialog
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
      ? 'bg-blue-500 dark:bg-blue-400'
      : effectiveStatus === 'waiting'
        ? 'bg-green-500 dark:bg-green-400'
        : effectiveStatus === 'disconnected'
          ? 'bg-red-500 dark:bg-red-400'
          : 'bg-muted-foreground';

  const badgeVariant =
    effectiveStatus === 'active'
      ? 'default'
      : effectiveStatus === 'waiting'
        ? 'secondary'
        : effectiveStatus === 'disconnected'
          ? 'destructive'
          : 'outline';

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-sm max-h-[70vh] flex flex-col gap-0 p-0">
        <DialogHeader className="px-4 py-3 border-b">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className={`w-2.5 h-2.5 ${indicatorClass}`} />
              <DialogTitle className="text-sm font-bold uppercase tracking-wider">
                {role.toUpperCase()}
              </DialogTitle>
            </div>
            <Badge variant={badgeVariant} className="text-xs">
              {statusLabel}
            </Badge>
          </div>
        </DialogHeader>

        <div className="p-4">
          <div className="flex items-center justify-between gap-2 mb-3">
            <span className="text-sm font-bold uppercase tracking-wider text-foreground">
              Agent Prompt
            </span>
            <CopyButton text={prompt} label="Copy Prompt" copiedLabel="Copied!" />
          </div>
          <button
            className="w-full text-left text-xs text-muted-foreground font-mono whitespace-pre-wrap break-words bg-muted p-3 max-h-[40vh] overflow-y-auto hover:text-foreground transition-colors"
            onClick={() => {
              onViewPrompt?.(role);
              onClose();
            }}
            title="Click to view full prompt in viewer"
          >
            {prompt.length > 500 ? prompt.substring(0, 500) + '...' : prompt}
          </button>
        </div>
      </DialogContent>
    </Dialog>
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
