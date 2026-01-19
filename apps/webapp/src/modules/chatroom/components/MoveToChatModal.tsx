'use client';

import type { Id } from '@workspace/backend/convex/_generated/dataModel';
import { MessageSquare, X } from 'lucide-react';
import React, { useState, useCallback, useEffect, useRef } from 'react';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

type TaskStatus = 'pending' | 'in_progress' | 'queued' | 'backlog' | 'completed' | 'cancelled';
type BacklogStatus = 'not_started' | 'started' | 'complete' | 'closed';

interface Task {
  _id: Id<'chatroom_tasks'>;
  content: string;
  status: TaskStatus;
  createdAt: number;
  updatedAt: number;
  queuePosition: number;
  assignedTo?: string;
  backlog?: {
    status: BacklogStatus;
  };
}

interface MoveToChatModalProps {
  isOpen: boolean;
  task: Task | null;
  onClose: () => void;
  onConfirm: (taskId: string, customMessage?: string) => Promise<void>;
}

export function MoveToChatModal({ isOpen, task, onClose, onConfirm }: MoveToChatModalProps) {
  const [customMessage, setCustomMessage] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Reset state when modal opens/closes
  useEffect(() => {
    if (isOpen) {
      setCustomMessage('');
      setError(null);
      // Focus textarea when modal opens
      setTimeout(() => textareaRef.current?.focus(), 100);
    }
  }, [isOpen]);

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

  // Handle backdrop click
  const handleBackdropClick = useCallback(
    (e: React.MouseEvent) => {
      if (e.target === e.currentTarget) {
        onClose();
      }
    },
    [onClose]
  );

  const handleConfirm = useCallback(async () => {
    if (!task) return;
    setIsLoading(true);
    setError(null);
    try {
      // Pass custom message if provided, otherwise undefined (backend will use task content)
      await onConfirm(task._id, customMessage.trim() || undefined);
      onClose();
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to send to chat';
      setError(message);
    } finally {
      setIsLoading(false);
    }
  }, [task, customMessage, onConfirm, onClose]);

  // Auto-resize textarea based on content
  useEffect(() => {
    const textarea = textareaRef.current;
    if (textarea) {
      textarea.style.height = 'auto';
      textarea.style.height = `${Math.min(textarea.scrollHeight, 200)}px`;
    }
  }, [customMessage]);

  if (!isOpen || !task) {
    return null;
  }

  // Truncate for preview
  const truncateContent = (content: string, maxLines = 5) => {
    const lines = content.split('\n');
    if (lines.length <= maxLines) return content;
    return lines.slice(0, maxLines).join('\n') + '\n...';
  };

  return (
    <>
      {/* Backdrop - z-[80] to layer above TaskDetailModal */}
      <div
        className="fixed inset-0 bg-black/60 z-[80] backdrop-blur-sm"
        onClick={handleBackdropClick}
      />

      {/* Modal - z-[90] to layer above backdrop */}
      <div className="fixed inset-x-4 top-1/2 -translate-y-1/2 md:inset-auto md:top-1/2 md:left-1/2 md:-translate-x-1/2 md:-translate-y-1/2 md:w-[95%] md:max-w-lg bg-chatroom-bg-primary border-2 border-chatroom-border-strong z-[90] flex flex-col animate-in fade-in zoom-in-95 duration-200 max-h-[80vh]">
        {/* Header */}
        <div className="flex justify-between items-center p-4 border-b-2 border-chatroom-border-strong bg-chatroom-bg-surface flex-shrink-0">
          <div className="flex items-center gap-2">
            <MessageSquare size={16} className="text-chatroom-accent" />
            <span className="text-sm font-bold text-chatroom-text-primary uppercase tracking-wide">
              Move to Chat
            </span>
          </div>
          <button
            className="bg-transparent border-2 border-chatroom-border text-chatroom-text-secondary w-8 h-8 flex items-center justify-center cursor-pointer transition-all duration-100 hover:bg-chatroom-bg-hover hover:border-chatroom-border-strong hover:text-chatroom-text-primary"
            onClick={onClose}
            aria-label="Close"
          >
            <X size={16} />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {/* Task Preview */}
          <div className="space-y-2">
            <label className="block text-[10px] font-bold uppercase tracking-widest text-chatroom-text-muted">
              Backlog Task
            </label>
            <div className="p-3 bg-chatroom-bg-tertiary border-2 border-chatroom-border text-xs text-chatroom-text-secondary prose dark:prose-invert prose-xs max-w-none">
              <Markdown remarkPlugins={[remarkGfm]}>{truncateContent(task.content)}</Markdown>
            </div>
          </div>

          {/* Custom Message Input */}
          <div className="space-y-2">
            <label className="block text-[10px] font-bold uppercase tracking-widest text-chatroom-text-muted">
              Message (optional)
            </label>
            <textarea
              ref={textareaRef}
              value={customMessage}
              onChange={(e) => setCustomMessage(e.target.value)}
              placeholder="Add a custom message, or leave empty to use the backlog task content..."
              className="w-full bg-chatroom-bg-primary border-2 border-chatroom-border text-chatroom-text-primary text-sm p-3 resize-none min-h-[80px] max-h-[200px] placeholder:text-chatroom-text-muted focus:outline-none focus:border-chatroom-border-strong"
            />
            <p className="text-[10px] text-chatroom-text-muted">
              If left empty, the backlog task content will be sent as the message.
            </p>
          </div>
        </div>

        {/* Error Message */}
        {error && (
          <div className="px-4 py-2 bg-chatroom-status-error/10 border-t-2 border-chatroom-status-error/30 flex-shrink-0">
            <p className="text-xs text-chatroom-status-error">{error}</p>
          </div>
        )}

        {/* Footer Actions */}
        <div className="p-4 border-t-2 border-chatroom-border-strong bg-chatroom-bg-surface flex items-center gap-2 flex-shrink-0">
          <button
            onClick={handleConfirm}
            disabled={isLoading}
            className="flex items-center gap-1 px-4 py-2 text-[10px] font-bold uppercase tracking-wide bg-chatroom-accent text-chatroom-bg-primary hover:bg-chatroom-text-secondary disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            <MessageSquare size={12} />
            Send to Chat
          </button>
          <button
            onClick={onClose}
            disabled={isLoading}
            className="flex items-center gap-1 px-4 py-2 text-[10px] font-bold uppercase tracking-wide text-chatroom-text-muted hover:text-chatroom-text-primary transition-colors"
          >
            Cancel
          </button>
        </div>
      </div>
    </>
  );
}
