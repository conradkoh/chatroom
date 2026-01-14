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
  participants: Participant[];
  onViewPrompt?: (role: string) => void;
}

export function AgentPanel({
  chatroomId,
  teamName = 'Team',
  teamRoles = [],
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
      });
    },
    [chatroomId, teamName, teamRoles]
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
    <div className="agent-panel">
      <div className="panel-title">Agents</div>
      <div className="agent-list">
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
            <div key={role} className="agent-item-wrapper">
              <div
                className={`agent-item agent-item-clickable ${isActive ? 'agent-working' : ''} ${isExpanded ? 'agent-expanded' : ''}`}
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
                <div
                  className={`agent-status ${status}`}
                  role="status"
                  aria-label={`Status: ${statusLabel}`}
                />
                <div className="agent-info">
                  <div className="agent-role">{role}</div>
                  <div className={`agent-state ${isActive ? 'state-working' : ''}`}>
                    {statusLabel}
                  </div>
                </div>
                <div className={`agent-expand-indicator ${isExpanded ? 'expanded' : ''}`}>
                  <ChevronRight size={14} />
                </div>
              </div>

              {isExpanded && (
                <div className="agent-prompt-row">
                  <div
                    className="prompt-preview-inline"
                    onClick={(e) => {
                      e.stopPropagation();
                      onViewPrompt?.(role);
                    }}
                    title="Click to view full prompt"
                  >
                    <span className="prompt-preview-text">{preview}</span>
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
