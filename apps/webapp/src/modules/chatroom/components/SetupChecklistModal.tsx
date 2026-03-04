'use client';

import { X, Settings2, Check } from 'lucide-react';
import React, { useCallback, memo, useEffect, useMemo, useState } from 'react';

import { SetupChecklist } from './SetupChecklist';

interface Participant {
  role: string;
  lastSeenAt?: number | null;
}

interface SetupChecklistModalProps {
  isOpen: boolean;
  onClose: () => void;
  chatroomId: string;
  teamName: string;
  teamRoles: string[];
  teamEntryPoint?: string;
  participants: Participant[];
  onViewPrompt: (role: string) => void;
  /** Current chatroom display name */
  chatroomName: string;
  /** Callback to rename the chatroom */
  onRenameChatroom: (newName: string) => Promise<void>;
}

export const SetupChecklistModal = memo(function SetupChecklistModal({
  isOpen,
  onClose,
  chatroomId,
  teamName,
  teamRoles,
  teamEntryPoint,
  participants,
  onViewPrompt,
  chatroomName,
  onRenameChatroom,
}: SetupChecklistModalProps) {
  // Chatroom name editing state
  const [editedName, setEditedName] = useState('');
  const [isSaving, setIsSaving] = useState(false);

  // Initialize editedName when modal opens or chatroomName changes
  useEffect(() => {
    if (isOpen) {
      setEditedName(chatroomName);
    }
  }, [isOpen, chatroomName]);

  // Save chatroom name
  const handleSaveName = useCallback(async () => {
    const trimmedName = editedName.trim();
    if (!trimmedName || trimmedName === chatroomName || isSaving) return;

    setIsSaving(true);
    try {
      await onRenameChatroom(trimmedName);
    } catch (error) {
      console.error('Failed to rename chatroom:', error);
      // Revert on error
      setEditedName(chatroomName);
    } finally {
      setIsSaving(false);
    }
  }, [editedName, chatroomName, isSaving, onRenameChatroom]);

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

  // Calculate agent join status
  const joinedCount = useMemo(() => {
    return teamRoles.filter((role) => {
      const p = participants.find((p) => p.role.toLowerCase() === role.toLowerCase());
      return p?.lastSeenAt != null;
    }).length;
  }, [participants, teamRoles]);

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4"
      onClick={handleBackdropClick}
    >
      <div className="chatroom-root w-full max-w-3xl max-h-[90vh] flex flex-col bg-chatroom-bg-primary border-2 border-chatroom-border-strong overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b-2 border-chatroom-border-strong bg-chatroom-bg-surface">
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2">
              <Settings2 size={18} className="text-chatroom-status-warning" />
              <h2 className="text-sm font-bold uppercase tracking-wider text-chatroom-text-primary">
                Setup Your Team
              </h2>
            </div>
            <span className="text-xs text-chatroom-text-muted">
              {joinedCount} of {teamRoles.length} agents ready
            </span>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 flex items-center justify-center text-chatroom-text-muted hover:text-chatroom-text-primary hover:bg-chatroom-bg-hover transition-colors"
            title="Dismiss setup (you can always access setup from the sidebar)"
          >
            <X size={18} />
          </button>
        </div>

        {/* Description */}
        <div className="px-4 py-3 border-b-2 border-chatroom-border bg-chatroom-bg-tertiary">
          <p className="text-xs text-chatroom-text-secondary">
            Connect your AI agents to start collaborating. You can dismiss this dialog and continue
            chatting - agents can be configured anytime from the sidebar.
          </p>
        </div>

        {/* Chatroom name input */}
        <div className="px-4 py-3 border-b border-chatroom-border flex items-center gap-3 bg-chatroom-bg-primary">
          <span className="text-[10px] font-bold uppercase tracking-widest text-chatroom-text-muted flex-shrink-0">
            Chatroom Name
          </span>
          <div className="flex-1 flex items-center gap-2">
            <input
              type="text"
              value={editedName}
              onChange={(e) => setEditedName(e.target.value)}
              onBlur={handleSaveName}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleSaveName();
              }}
              placeholder="Enter chatroom name..."
              className="flex-1 bg-chatroom-bg-tertiary border border-chatroom-border text-sm text-chatroom-text-primary px-2 py-1 focus:outline-none focus:border-chatroom-accent disabled:opacity-50"
              disabled={isSaving}
              maxLength={100}
            />
            {editedName.trim() !== chatroomName && editedName.trim() !== '' && (
              <button
                onClick={handleSaveName}
                disabled={isSaving}
                className="text-chatroom-status-success hover:text-chatroom-status-success/80 disabled:opacity-50 transition-colors"
                title="Save name"
              >
                <Check size={16} />
              </button>
            )}
          </div>
        </div>

        {/* Scrollable content - SetupChecklist without its own header */}
        <div className="flex-1 overflow-y-auto">
          <SetupChecklist
            chatroomId={chatroomId}
            teamName={teamName}
            teamRoles={teamRoles}
            teamEntryPoint={teamEntryPoint}
            participants={participants}
            onViewPrompt={onViewPrompt}
            hideHeader
          />
        </div>
      </div>
    </div>
  );
});
