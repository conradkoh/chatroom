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
  teamEntryPoint?: string;
  participants: Participant[];
  onViewPrompt: (role: string) => void;
}

export const SetupChecklist = memo(function SetupChecklist({
  chatroomId,
  teamName,
  teamRoles,
  teamEntryPoint,
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
        teamEntryPoint,
      });
    },
    [chatroomId, teamName, teamRoles, teamEntryPoint]
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
    <div className="max-w-2xl mx-auto p-6">
      {/* Header */}
      <div className="mb-6 pb-6 border-b-2 border-chatroom-border">
        <h2 className="flex items-center gap-2 text-lg font-bold uppercase tracking-widest text-chatroom-text-primary mb-2">
          <Rocket size={20} /> Setup Your Team
        </h2>
        <p className="text-sm text-chatroom-text-muted">
          {joinedCount} of {teamRoles.length} agents ready
        </p>
      </div>

      {/* Instructions */}
      <div className="bg-chatroom-bg-tertiary border-l-2 border-chatroom-status-info p-4 mb-6">
        <p className="text-sm text-chatroom-text-secondary">
          Copy each prompt below and paste it into your AI assistant to set up each agent.
        </p>
      </div>

      {/* Steps */}
      <div className="flex flex-col gap-4">
        {teamRoles.map((role, index) => {
          const participant = participantMap.get(role.toLowerCase());
          const isJoined = participant !== undefined;
          const prompt = generatePrompt(role);
          const preview = getPromptPreview(prompt);

          return (
            <div
              key={role}
              className={`bg-chatroom-bg-surface border-2 transition-all duration-100 ${
                isJoined
                  ? 'border-emerald-400/30 bg-emerald-400/5'
                  : 'border-chatroom-border hover:border-chatroom-border-strong'
              }`}
            >
              {/* Step Header */}
              <div className="flex justify-between items-center p-4">
                <div className="flex items-center gap-3">
                  <span
                    className={`w-6 h-6 flex items-center justify-center text-xs font-bold ${
                      isJoined
                        ? 'bg-chatroom-status-success text-chatroom-bg-primary'
                        : 'bg-chatroom-bg-hover text-chatroom-text-muted'
                    }`}
                  >
                    {isJoined ? <Check size={14} /> : index + 1}
                  </span>
                  <span className="text-sm font-bold uppercase tracking-wide text-chatroom-text-primary">
                    {role}
                  </span>
                </div>
                <span
                  className={`px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${
                    isJoined
                      ? 'bg-emerald-400/15 text-chatroom-status-success'
                      : 'bg-amber-400/15 text-chatroom-status-warning'
                  }`}
                >
                  {isJoined ? 'Ready' : 'Waiting'}
                </span>
              </div>

              {/* Step Content - only show for pending steps */}
              {!isJoined && (
                <div className="px-4 pb-4 flex flex-col gap-3">
                  {/* Prompt Preview */}
                  <div
                    className="flex justify-between items-center p-3 bg-chatroom-bg-primary cursor-pointer hover:bg-chatroom-bg-hover transition-all duration-100"
                    onClick={() => onViewPrompt(role)}
                    title="Click to view full prompt"
                  >
                    <span className="font-mono text-xs text-chatroom-text-muted truncate flex-1">
                      {preview}
                    </span>
                    <span className="flex items-center gap-1 text-[10px] font-bold uppercase tracking-wide text-chatroom-status-info ml-3">
                      View <ArrowRight size={12} />
                    </span>
                  </div>
                  {/* Actions */}
                  <div className="flex justify-end">
                    <CopyButton text={prompt} label="Copy Prompt" copiedLabel="Copied!" />
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Footer */}
      <div className="mt-6 pt-6 border-t-2 border-chatroom-border">
        <p className="flex items-center gap-2 text-xs text-chatroom-text-muted">
          <Lightbulb size={14} className="text-chatroom-status-warning" /> Tip: Start with the first
          agent and work your way down
        </p>
      </div>
    </div>
  );
});
