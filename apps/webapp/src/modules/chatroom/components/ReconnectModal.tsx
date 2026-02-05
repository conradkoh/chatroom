'use client';

import { RefreshCw, AlertTriangle, X, Copy, Check, Play } from 'lucide-react';
import React, { useCallback, memo, useMemo, useState, useEffect } from 'react';

import { ChatroomAgentDetailsModal } from './ChatroomAgentDetailsModal';

import { usePrompts } from '@/contexts/PromptsContext';

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

/**
 * Copy button component styled for chatroom theme
 */
function CopyPromptButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error('Failed to copy:', err);
    }
  }, [text]);

  return (
    <button
      onClick={handleCopy}
      className="flex items-center gap-2 px-3 py-1.5 bg-chatroom-accent text-chatroom-text-on-accent text-[10px] font-bold uppercase tracking-wider transition-all hover:opacity-90"
    >
      {copied ? (
        <>
          <Check size={12} />
          Copied!
        </>
      ) : (
        <>
          <Copy size={12} />
          Copy Prompt
        </>
      )}
    </button>
  );
}

export const ReconnectModal = memo(function ReconnectModal({
  isOpen,
  onClose,
  chatroomId,
  teamName: _teamName,
  teamRoles: _teamRoles,
  teamEntryPoint: _teamEntryPoint,
  expiredRoles,
  participants: _participants, // Reserved for future use
  onViewPrompt,
}: ReconnectModalProps) {
  const { getAgentPrompt } = usePrompts();

  // Start agent modal state
  const [startAgentRole, setStartAgentRole] = useState<string | null>(null);

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

  // Generate prompts for expired roles
  const expiredRolePrompts = useMemo(() => {
    return expiredRoles.map((role) => ({
      role,
      prompt: getAgentPrompt(role) || '',
    }));
  }, [expiredRoles, getAgentPrompt]);

  // Get first line of prompt for preview
  const getPromptPreview = useCallback((prompt: string): string => {
    const firstLine = prompt.split('\n')[0] || '';
    if (firstLine.length > 50) {
      return firstLine.substring(0, 50) + '...';
    }
    return firstLine;
  }, []);

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

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4"
      onClick={handleBackdropClick}
    >
      <div className="chatroom-root w-full max-w-2xl max-h-[85vh] flex flex-col bg-chatroom-bg-primary border-2 border-chatroom-border-strong overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b-2 border-chatroom-border-strong bg-chatroom-bg-surface">
          <div className="flex items-center gap-2">
            <AlertTriangle size={18} className="text-chatroom-status-error" />
            <h2 className="text-sm font-bold uppercase tracking-wider text-chatroom-text-primary">
              Agents Disconnected
            </h2>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 flex items-center justify-center text-chatroom-text-muted hover:text-chatroom-text-primary hover:bg-chatroom-bg-hover transition-colors"
          >
            <X size={18} />
          </button>
        </div>

        {/* Description */}
        <div className="px-4 py-3 border-b-2 border-chatroom-border bg-chatroom-bg-tertiary">
          <p className="text-xs text-chatroom-text-secondary">
            The following agents have disconnected and need to be reconnected. Copy the prompt for
            each agent and paste it into their terminal.
          </p>
        </div>

        {/* Scrollable content */}
        <div className="flex-1 overflow-y-auto p-4 space-y-3">
          {expiredRolePrompts.map(({ role, prompt }) => {
            const preview = getPromptPreview(prompt);

            return (
              <div
                key={role}
                className="border-2 border-chatroom-status-error/30 bg-chatroom-bg-tertiary"
              >
                {/* Card Header */}
                <div className="flex items-center justify-between px-3 py-2 border-b-2 border-chatroom-border">
                  <div className="flex items-center gap-2">
                    <RefreshCw size={14} className="text-chatroom-status-error" />
                    <span className="text-xs font-bold uppercase tracking-wider text-chatroom-text-primary">
                      {role}
                    </span>
                  </div>
                  <span className="px-2 py-0.5 bg-chatroom-status-error/15 text-chatroom-status-error text-[10px] font-bold uppercase tracking-wide">
                    Disconnected
                  </span>
                </div>

                {/* Card Content */}
                <div className="p-3 space-y-3">
                  {/* Start Agent Button */}
                  <button
                    onClick={() => setStartAgentRole(role)}
                    className="w-full flex items-center justify-center gap-2 px-4 py-2.5 bg-chatroom-status-info text-white text-xs font-bold uppercase tracking-wider hover:bg-chatroom-status-info/90 transition-colors"
                  >
                    <Play size={14} />
                    Start Agent Remotely
                  </button>

                  {/* Prompt Preview */}
                  {onViewPrompt && (
                    <button
                      className="w-full flex items-center justify-between p-2 bg-chatroom-bg-hover text-left hover:bg-chatroom-accent-subtle transition-colors"
                      onClick={() => onViewPrompt(role)}
                      title="Click to view full prompt"
                    >
                      <span className="font-mono text-xs text-chatroom-text-secondary truncate flex-1">
                        {preview}
                      </span>
                      <span className="text-[10px] font-bold uppercase tracking-wider text-chatroom-status-info ml-2 flex-shrink-0">
                        View
                      </span>
                    </button>
                  )}

                  {/* Copy Button */}
                  <div className="flex justify-end">
                    <CopyPromptButton text={prompt} />
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        {/* Footer */}
        <div className="px-4 py-3 border-t-2 border-chatroom-border-strong bg-chatroom-bg-surface">
          <div className="space-y-2 text-xs text-chatroom-text-secondary">
            <p className="font-bold uppercase tracking-wide text-chatroom-text-muted">
              To reconnect manually:
            </p>
            <ol className="list-decimal list-inside space-y-1 ml-2">
              <li>Copy the prompt using the button above</li>
              <li>Paste it into the agent&apos;s terminal</li>
              <li>
                Run{' '}
                <code className="bg-chatroom-bg-tertiary px-1.5 py-0.5 text-chatroom-status-success font-mono text-[11px]">
                  wait-for-task
                </code>{' '}
                to reconnect
              </li>
            </ol>
          </div>
        </div>
      </div>

      {/* Agent Details Modal */}
      {startAgentRole && (
        <ChatroomAgentDetailsModal
          isOpen={true}
          onClose={() => setStartAgentRole(null)}
          chatroomId={chatroomId}
          role={startAgentRole}
          effectiveStatus="disconnected"
          onViewPrompt={onViewPrompt}
        />
      )}
    </div>
  );
});
