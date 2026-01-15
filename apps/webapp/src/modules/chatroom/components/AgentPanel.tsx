'use client';

import { ChevronRight } from 'lucide-react';
import React, { useState, useMemo, useCallback } from 'react';

import { CopyButton } from './CopyButton';
import { generateAgentPrompt } from '../prompts/generator';

interface Participant {
  role: string;
  status: string;
}

interface AgentPanelProps {
  chatroomId: string;
  teamName?: string;
  teamRoles?: string[];
  teamEntryPoint?: string;
  participants: Participant[];
  onViewPrompt?: (role: string) => void;
}

// Status indicator colors
const getStatusClasses = (status: string) => {
  const base = 'w-2.5 h-2.5 flex-shrink-0';
  switch (status) {
    case 'active':
      return `${base} bg-chatroom-status-info`;
    case 'waiting':
      return `${base} bg-chatroom-status-success`;
    default:
      return `${base} bg-chatroom-text-muted`;
  }
};

export function AgentPanel({
  chatroomId,
  teamName = 'Team',
  teamRoles = [],
  teamEntryPoint,
  participants,
  onViewPrompt,
}: AgentPanelProps) {
  const [expandedRole, setExpandedRole] = useState<string | null>(null);

  // Memoize the participant map
  const participantMap = useMemo(
    () => new Map(participants.map((p) => [p.role.toLowerCase(), p])),
    [participants]
  );

  // Determine which roles to show (memoized)
  const rolesToShow = useMemo(
    () => (teamRoles.length > 0 ? teamRoles : Array.from(participantMap.keys())),
    [teamRoles, participantMap]
  );

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

  return (
    <div className="flex flex-col border-b-2 border-chatroom-border-strong overflow-hidden flex-1">
      <div className="text-[10px] font-bold uppercase tracking-widest text-chatroom-text-muted p-4 border-b-2 border-chatroom-border">
        Agents
      </div>
      <div className="overflow-y-auto flex-1">
        {rolesToShow.map((role) => {
          const participant = participantMap.get(role.toLowerCase());
          const status = participant?.status || 'missing';
          const prompt = generatePrompt(role);
          const preview = getPromptPreview(prompt);
          const isExpanded = expandedRole === role;

          const statusLabel =
            status === 'missing'
              ? 'NOT JOINED'
              : status === 'waiting'
                ? 'READY'
                : status === 'active'
                  ? 'WORKING'
                  : 'IDLE';

          const isActive = status === 'active';

          return (
            <div key={role} className="border-b border-chatroom-border last:border-b-0">
              <div
                className={`flex items-center gap-3 p-3 cursor-pointer transition-all duration-100 hover:bg-chatroom-bg-hover ${isActive ? 'bg-blue-400/5' : ''} ${isExpanded ? 'bg-chatroom-bg-tertiary' : ''}`}
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
                  className={getStatusClasses(status)}
                  role="status"
                  aria-label={`Status: ${statusLabel}`}
                />
                {/* Agent Info */}
                <div className="flex-1 min-w-0">
                  <div className="text-xs font-bold uppercase tracking-wide text-chatroom-text-primary">
                    {role}
                  </div>
                  <div
                    className={`text-[10px] font-bold uppercase tracking-wide ${isActive ? 'text-chatroom-status-info animate-pulse' : 'text-chatroom-text-muted'}`}
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
        })}
      </div>
    </div>
  );
}
