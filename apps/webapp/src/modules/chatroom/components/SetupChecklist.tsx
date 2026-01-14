'use client';

import { Rocket, Check, Lightbulb, ArrowRight } from 'lucide-react';
import React, { useMemo, useCallback, memo } from 'react';

import { CopyButton } from './CopyButton';
import { generateAgentPrompt } from '../prompts/generator';

interface Participant {
  role: string;
  status: string;
}

interface SetupChecklistProps {
  chatroomId: string;
  teamName: string;
  teamRoles: string[];
  participants: Participant[];
  onViewPrompt: (role: string) => void;
}

export const SetupChecklist = memo(function SetupChecklist({
  chatroomId,
  teamName,
  teamRoles,
  participants,
  onViewPrompt,
}: SetupChecklistProps) {
  // Memoize participant map
  const participantMap = useMemo(
    () => new Map(participants.map((p) => [p.role.toLowerCase(), p])),
    [participants]
  );

  // Memoize prompt generation
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

  // Get first line of prompt for preview (pure function, no need for useCallback)
  const getPromptPreview = useCallback((prompt: string): string => {
    const firstLine = prompt.split('\n')[0] || '';
    if (firstLine.length > 60) {
      return firstLine.substring(0, 60) + '...';
    }
    return firstLine;
  }, []);

  // Memoize joined count
  const joinedCount = useMemo(
    () => teamRoles.filter((role) => participantMap.has(role.toLowerCase())).length,
    [teamRoles, participantMap]
  );

  return (
    <div className="setup-checklist">
      <div className="setup-header">
        <h2 className="setup-title">
          <Rocket size={20} /> Setup Your Team
        </h2>
        <p className="setup-subtitle">
          {joinedCount} of {teamRoles.length} agents ready
        </p>
      </div>

      <div className="setup-instructions">
        <p>Copy each prompt below and paste it into your AI assistant to set up each agent.</p>
      </div>

      <div className="setup-steps">
        {teamRoles.map((role, index) => {
          const participant = participantMap.get(role.toLowerCase());
          const isJoined = participant !== undefined;
          const prompt = generatePrompt(role);
          const preview = getPromptPreview(prompt);

          return (
            <div key={role} className={`setup-step ${isJoined ? 'setup-step-complete' : ''}`}>
              <div className="setup-step-header">
                <div className="setup-step-left">
                  <span className={`setup-step-number ${isJoined ? 'complete' : ''}`}>
                    {isJoined ? <Check size={14} /> : index + 1}
                  </span>
                  <span className="setup-step-role">{role}</span>
                </div>
                <span className={`setup-step-status ${isJoined ? 'joined' : 'pending'}`}>
                  {isJoined ? 'Ready' : 'Waiting'}
                </span>
              </div>

              {!isJoined && (
                <div className="setup-step-content">
                  <div
                    className="prompt-preview"
                    onClick={() => onViewPrompt(role)}
                    title="Click to view full prompt"
                  >
                    <span className="prompt-preview-text">{preview}</span>
                    <span className="prompt-preview-expand">
                      View <ArrowRight size={12} />
                    </span>
                  </div>
                  <div className="setup-step-actions">
                    <CopyButton text={prompt} label="Copy Prompt" copiedLabel="Copied!" />
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>

      <div className="setup-footer">
        <p className="setup-hint">
          <Lightbulb size={14} /> Tip: Start with the first agent and work your way down
        </p>
      </div>
    </div>
  );
});
