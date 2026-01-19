'use client';

import type { Id } from '@workspace/backend/convex/_generated/dataModel';
import { ArrowRight, Check, Pencil, StopCircle, Trash2, X } from 'lucide-react';
import React, { useState, useCallback, useEffect } from 'react';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

import { useIsDesktop } from '@/hooks/useIsDesktop';

type TaskStatus = 'pending' | 'in_progress' | 'queued' | 'backlog' | 'completed' | 'cancelled';

interface Task {
  _id: Id<'chatroom_tasks'>;
  content: string;
  status: TaskStatus;
  createdAt: number;
  queuePosition: number;
  assignedTo?: string;
}

interface TaskDetailModalProps {
  isOpen: boolean;
  task: Task | null;
  onClose: () => void;
  onEdit: (taskId: string, content: string) => Promise<void>;
  onDelete: (taskId: string) => Promise<void>;
  onMoveToQueue: (taskId: string) => Promise<void>;
  onForceComplete: (taskId: string) => Promise<void>;
  isProtected?: boolean;
}

// Status badge colors
const getStatusBadge = (status: TaskStatus) => {
  switch (status) {
    case 'pending':
      return {
        emoji: '🟢',
        label: 'Pending',
        classes: 'bg-chatroom-status-success/15 text-chatroom-status-success',
      };
    case 'in_progress':
      return {
        emoji: '🔵',
        label: 'Working',
        classes: 'bg-chatroom-status-info/15 text-chatroom-status-info',
      };
    case 'queued':
      return {
        emoji: '🟡',
        label: 'Queued',
        classes: 'bg-chatroom-status-warning/15 text-chatroom-status-warning',
      };
    case 'backlog':
      return {
        emoji: '⚪',
        label: 'Backlog',
        classes: 'bg-chatroom-text-muted/15 text-chatroom-text-muted',
      };
    default:
      return {
        emoji: '⚫',
        label: status,
        classes: 'bg-chatroom-text-muted/15 text-chatroom-text-muted',
      };
  }
};

export function TaskDetailModal({
  isOpen,
  task,
  onClose,
  onEdit,
  onDelete,
  onMoveToQueue,
  onForceComplete,
  isProtected = false,
}: TaskDetailModalProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [editedContent, setEditedContent] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const isDesktop = useIsDesktop();

  // Track which task we've initialized for - prevents resetting during edits
  const [initializedTaskId, setInitializedTaskId] = useState<string | null>(null);

  // Reset state when modal opens with a different task
  useEffect(() => {
    if (isOpen && task && task._id !== initializedTaskId) {
      setEditedContent(task.content);
      setIsEditing(false);
      setError(null);
      setInitializedTaskId(task._id);
    } else if (!isOpen) {
      // Reset when modal closes
      setInitializedTaskId(null);
      setError(null);
    }
  }, [isOpen, task, initializedTaskId]);

  // Handle Escape key
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (isEditing) {
          setIsEditing(false);
        } else {
          onClose();
        }
      }
    },
    [onClose, isEditing]
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

  const handleSave = useCallback(async () => {
    if (!task || !editedContent.trim()) return;
    setIsLoading(true);
    setError(null);
    try {
      await onEdit(task._id, editedContent.trim());
      setIsEditing(false);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to save changes';
      setError(message);
      // Keep editing mode open so user can retry
    } finally {
      setIsLoading(false);
    }
  }, [task, editedContent, onEdit]);

  const handleDelete = useCallback(async () => {
    if (!task) return;
    setIsLoading(true);
    setError(null);
    try {
      await onDelete(task._id);
      onClose();
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to delete task';
      setError(message);
    } finally {
      setIsLoading(false);
    }
  }, [task, onDelete, onClose]);

  const handleMoveToQueue = useCallback(async () => {
    if (!task) return;
    setIsLoading(true);
    setError(null);
    try {
      await onMoveToQueue(task._id);
      onClose();
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to move task';
      setError(message);
    } finally {
      setIsLoading(false);
    }
  }, [task, onMoveToQueue, onClose]);

  const handleForceComplete = useCallback(async () => {
    if (!task) return;
    setIsLoading(true);
    setError(null);
    try {
      await onForceComplete(task._id);
      onClose();
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to complete task';
      setError(message);
    } finally {
      setIsLoading(false);
    }
  }, [task, onForceComplete, onClose]);

  if (!isOpen || !task) {
    return null;
  }

  const badge = getStatusBadge(task.status);

  return (
    <>
      {/* Backdrop - z-60 to layer above TaskQueueModal */}
      <div
        className="fixed inset-0 bg-black/60 z-[60] backdrop-blur-sm"
        onClick={handleBackdropClick}
      />

      {/* Modal - z-[70] to layer above backdrop */}
      {/* Desktop (lg+): Wider modal for better editing experience */}
      <div className="fixed inset-x-2 top-16 bottom-2 md:inset-auto md:top-1/2 md:left-1/2 md:-translate-x-1/2 md:-translate-y-1/2 md:w-[95%] md:max-w-lg md:max-h-[85vh] lg:max-w-5xl lg:max-h-[90vh] lg:w-[90%] bg-chatroom-bg-primary border-2 border-chatroom-border-strong z-[70] flex flex-col animate-in fade-in zoom-in-95 duration-200">
        {/* Header */}
        <div className="flex justify-between items-center p-4 border-b-2 border-chatroom-border-strong bg-chatroom-bg-surface flex-shrink-0">
          <div className="flex items-center gap-3">
            <span
              className={`px-2 py-1 text-[10px] font-bold uppercase tracking-wide ${badge.classes}`}
            >
              {badge.label}
            </span>
            {task.assignedTo && (
              <span className="text-[10px] text-chatroom-text-muted">→ {task.assignedTo}</span>
            )}
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
        <div className="flex-1 overflow-hidden min-h-0">
          {isEditing ? (
            // Desktop: Split-panel with editor on left, preview on right
            // Mobile/Tablet: Single textarea
            isDesktop ? (
              <div className="flex h-full">
                {/* Editor Panel */}
                <div className="flex-1 flex flex-col border-r border-chatroom-border">
                  <div className="px-4 py-2 text-[10px] font-bold uppercase tracking-widest text-chatroom-text-muted bg-chatroom-bg-tertiary border-b border-chatroom-border">
                    Editor
                  </div>
                  <textarea
                    value={editedContent}
                    onChange={(e) => setEditedContent(e.target.value)}
                    onKeyDown={(e) => {
                      // Cmd+Enter or Ctrl+Enter to save
                      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
                        e.preventDefault();
                        if (editedContent.trim()) {
                          handleSave();
                        }
                      }
                    }}
                    className="flex-1 w-full bg-chatroom-bg-primary border-0 text-chatroom-text-primary text-sm p-4 resize-none focus:outline-none font-mono"
                    autoFocus
                    placeholder="Write your markdown here..."
                  />
                </div>
                {/* Preview Panel */}
                <div className="flex-1 flex flex-col">
                  <div className="px-4 py-2 text-[10px] font-bold uppercase tracking-widest text-chatroom-text-muted bg-chatroom-bg-tertiary border-b border-chatroom-border">
                    Preview
                  </div>
                  <div className="flex-1 overflow-y-auto p-4 text-sm text-chatroom-text-primary prose dark:prose-invert prose-sm max-w-none prose-headings:font-bold prose-headings:mt-4 prose-headings:mb-2 prose-p:my-2 prose-code:bg-chatroom-bg-tertiary prose-code:px-1.5 prose-code:py-0.5 prose-code:text-chatroom-status-success prose-code:text-[0.9em] prose-pre:bg-chatroom-bg-tertiary prose-pre:border-2 prose-pre:border-chatroom-border prose-pre:my-3 prose-a:text-chatroom-status-info prose-a:no-underline hover:prose-a:text-chatroom-accent">
                    <Markdown remarkPlugins={[remarkGfm]}>
                      {editedContent || '*No content yet*'}
                    </Markdown>
                  </div>
                </div>
              </div>
            ) : (
              // Mobile/Tablet: Single textarea
              <div className="h-full p-4 overflow-y-auto">
                <textarea
                  value={editedContent}
                  onChange={(e) => setEditedContent(e.target.value)}
                  onKeyDown={(e) => {
                    // Cmd+Enter or Ctrl+Enter to save
                    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
                      e.preventDefault();
                      if (editedContent.trim()) {
                        handleSave();
                      }
                    }
                  }}
                  className="w-full h-full min-h-[200px] bg-chatroom-bg-tertiary border-2 border-chatroom-border text-chatroom-text-primary text-sm p-3 resize-none focus:outline-none focus:border-chatroom-accent"
                  autoFocus
                />
              </div>
            )
          ) : (
            <div className="h-full overflow-y-auto p-4 text-sm text-chatroom-text-primary prose dark:prose-invert prose-sm max-w-none prose-headings:font-bold prose-headings:mt-4 prose-headings:mb-2 prose-p:my-2 prose-code:bg-chatroom-bg-tertiary prose-code:px-1.5 prose-code:py-0.5 prose-code:text-chatroom-status-success prose-code:text-[0.9em] prose-pre:bg-chatroom-bg-tertiary prose-pre:border-2 prose-pre:border-chatroom-border prose-pre:my-3 prose-a:text-chatroom-status-info prose-a:no-underline hover:prose-a:text-chatroom-accent">
              <Markdown remarkPlugins={[remarkGfm]}>{task.content}</Markdown>
            </div>
          )}
        </div>

        {/* Error Message */}
        {error && (
          <div className="px-4 py-2 bg-chatroom-status-error/10 border-t-2 border-chatroom-status-error/30 flex-shrink-0">
            <p className="text-xs text-chatroom-status-error">{error}</p>
          </div>
        )}

        {/* Footer Actions */}
        {!isProtected && (
          <div className="p-4 border-t-2 border-chatroom-border-strong bg-chatroom-bg-surface flex items-center gap-2 flex-shrink-0">
            {isEditing ? (
              <>
                <button
                  onClick={handleSave}
                  disabled={isLoading || !editedContent.trim()}
                  className="flex items-center gap-1 px-3 py-2 text-[10px] font-bold uppercase tracking-wide bg-chatroom-accent text-chatroom-bg-primary hover:bg-chatroom-text-secondary disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                >
                  <Check size={12} />
                  Save
                </button>
                <button
                  onClick={() => setIsEditing(false)}
                  disabled={isLoading}
                  className="flex items-center gap-1 px-3 py-2 text-[10px] font-bold uppercase tracking-wide text-chatroom-text-muted hover:text-chatroom-text-primary transition-colors"
                >
                  <X size={12} />
                  Cancel
                </button>
              </>
            ) : (
              <>
                <button
                  onClick={() => setIsEditing(true)}
                  className="flex items-center gap-1 px-3 py-2 text-[10px] font-bold uppercase tracking-wide border-2 border-chatroom-border text-chatroom-text-secondary hover:bg-chatroom-bg-hover hover:border-chatroom-border-strong hover:text-chatroom-text-primary transition-colors"
                >
                  <Pencil size={12} />
                  Edit
                </button>
                <button
                  onClick={handleDelete}
                  disabled={isLoading}
                  className="flex items-center gap-1 px-3 py-2 text-[10px] font-bold uppercase tracking-wide border-2 border-chatroom-border text-chatroom-text-secondary hover:bg-chatroom-status-error/10 hover:border-chatroom-status-error/30 hover:text-chatroom-status-error transition-colors"
                >
                  <Trash2 size={12} />
                  Delete
                </button>
                {task.status === 'backlog' && (
                  <button
                    onClick={handleMoveToQueue}
                    disabled={isLoading}
                    className="flex items-center gap-1 px-3 py-2 text-[10px] font-bold uppercase tracking-wide bg-chatroom-accent text-chatroom-bg-primary hover:bg-chatroom-text-secondary transition-colors ml-auto"
                  >
                    <ArrowRight size={12} />
                    Move to Queue
                  </button>
                )}
                {(task.status === 'in_progress' || task.status === 'pending') && (
                  <button
                    onClick={handleForceComplete}
                    disabled={isLoading}
                    className="flex items-center gap-1 px-3 py-2 text-[10px] font-bold uppercase tracking-wide border-2 border-chatroom-status-warning/30 text-chatroom-status-warning hover:bg-chatroom-status-warning/10 hover:border-chatroom-status-warning transition-colors ml-auto"
                    title="Force complete this stuck task"
                  >
                    <StopCircle size={12} />
                    Force Complete
                  </button>
                )}
              </>
            )}
          </div>
        )}
      </div>
    </>
  );
}
