'use client';

import { X, RefreshCw, AlertTriangle } from 'lucide-react';
import React, { useEffect, useCallback, memo, useMemo } from 'react';

import { CopyButton } from './CopyButton';
import { generateAgentPrompt } from '../prompts/generator';

interface ParticipantInfo {
  role: string;
  status: string;
  readyUntil?: number;
  isExpired: boolean;
}

interface ReconnectModalProps {
  isOpen: boolean;
  onClose: () => void;
  chatroomId: string;
  teamName: string;
  teamRoles: string[];
  teamEntryPoint?: string;
  expiredRoles: string[];
  // participants prop is available for future use (e.g., showing status)
  participants?: ParticipantInfo[];
  onViewPrompt?: (role: string) => void;
}

export const ReconnectModal = memo(function ReconnectModal({
  isOpen,
  onClose,
  chatroomId,
  teamName,
  teamRoles,
  teamEntryPoint,
  expiredRoles,
  participants: _participants, // Reserved for future use
  onViewPrompt,
}: ReconnectModalProps) {
  // Handle Escape key
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    },
    [onClose]
  );

  useEffect(() => {
    if (isOpen) {
      document.addEventListener('keydown', handleKeyDown);
    }
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen, handleKeyDown]);

  // Generate prompts for expired roles
  const expiredRolePrompts = useMemo(() => {
    return expiredRoles.map((role) => ({
      role,
      prompt: generateAgentPrompt({
        chatroomId,
        role,
        teamName,
        teamRoles,
        teamEntryPoint,
      }),
    }));
  }, [chatroomId, teamName, teamRoles, teamEntryPoint, expiredRoles]);

  // Get first line of prompt for preview
  const getPromptPreview = useCallback((prompt: string): string => {
    const firstLine = prompt.split('\n')[0] || '';
    if (firstLine.length > 50) {
      return firstLine.substring(0, 50) + '...';
    }
    return firstLine;
  }, []);

  if (!isOpen) {
    return null;
  }

  // Handle backdrop click
  const handleBackdropClick = (e: React.MouseEvent) => {
    if (e.target === e.currentTarget) {
      onClose();
    }
  };

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/60 z-40 backdrop-blur-sm"
        onClick={handleBackdropClick}
      />

      {/* Modal */}
      <div className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[95%] max-w-lg bg-chatroom-bg-primary border-2 border-chatroom-border-strong z-50 flex flex-col animate-in fade-in zoom-in-95 duration-200 max-h-[85vh]">
        {/* Header */}
        <div className="flex justify-between items-center p-4 border-b-2 border-chatroom-border-strong bg-chatroom-bg-surface">
          <div className="flex items-center gap-3">
            <div className="text-chatroom-status-error">
              <AlertTriangle size={20} />
            </div>
            <div className="flex flex-col gap-0.5">
              <span className="text-[10px] font-bold uppercase tracking-widest text-chatroom-text-muted">
                Agents Disconnected
              </span>
              <span className="text-sm font-bold uppercase tracking-wide text-chatroom-text-primary">
                Reconnect Team
              </span>
            </div>
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
        <div className="flex-1 overflow-y-auto p-4">
          {/* Instructions */}
          <div className="bg-chatroom-bg-tertiary border-l-2 border-chatroom-status-warning p-3 mb-4">
            <p className="text-xs text-chatroom-text-secondary">
              The following agents have disconnected. Copy and paste the prompt for each agent to
              reconnect them.
            </p>
          </div>

          {/* Expired Roles */}
          <div className="flex flex-col gap-3">
            {expiredRolePrompts.map(({ role, prompt }) => {
              const preview = getPromptPreview(prompt);

              return (
                <div
                  key={role}
                  className="bg-chatroom-bg-surface border-2 border-chatroom-status-error/30 hover:border-chatroom-status-error/50 transition-all duration-100"
                >
                  {/* Role Header */}
                  <div className="flex justify-between items-center p-3 border-b border-chatroom-border">
                    <div className="flex items-center gap-2">
                      <RefreshCw size={14} className="text-chatroom-status-error" />
                      <span className="text-xs font-bold uppercase tracking-wide text-chatroom-text-primary">
                        {role}
                      </span>
                    </div>
                    <span className="px-2 py-0.5 text-[9px] font-bold uppercase tracking-wide bg-red-400/15 text-chatroom-status-error">
                      Disconnected
                    </span>
                  </div>

                  {/* Prompt Preview & Actions */}
                  <div className="p-3 flex flex-col gap-2">
                    {/* Prompt Preview */}
                    {onViewPrompt && (
                      <div
                        className="flex justify-between items-center p-2 bg-chatroom-bg-primary cursor-pointer hover:bg-chatroom-bg-hover transition-all duration-100"
                        onClick={() => onViewPrompt(role)}
                        title="Click to view full prompt"
                      >
                        <span className="font-mono text-[10px] text-chatroom-text-muted truncate flex-1">
                          {preview}
                        </span>
                        <span className="text-[9px] font-bold uppercase tracking-wide text-chatroom-status-info ml-2">
                          View
                        </span>
                      </div>
                    )}

                    {/* Copy Button */}
                    <div className="flex justify-end">
                      <CopyButton text={prompt} label="Copy Prompt" copiedLabel="Copied!" />
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Footer */}
        <div className="p-4 border-t-2 border-chatroom-border-strong bg-chatroom-bg-surface">
          <p className="text-[10px] text-chatroom-text-muted text-center">
            After pasting prompts, agents will automatically reconnect when they run{' '}
            <code className="bg-chatroom-bg-tertiary px-1 text-chatroom-status-success">
              wait-for-message
            </code>
          </p>
        </div>
      </div>
    </>
  );
});
