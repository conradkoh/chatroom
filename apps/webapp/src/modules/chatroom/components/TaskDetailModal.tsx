'use client';

import type { Id } from '@workspace/backend/convex/_generated/dataModel';
import {
  Check,
  CheckCircle,
  MoreHorizontal,
  Pencil,
  Plus,
  RotateCcw,
  StopCircle,
  Trash2,
  X,
  XCircle,
} from 'lucide-react';
import React, { useState, useCallback, useEffect } from 'react';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

import { useAttachedTasks, MAX_ATTACHMENTS } from '../context/AttachedTasksContext';

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

type TaskStatus =
  | 'pending'
  | 'in_progress'
  | 'queued'
  | 'backlog'
  | 'pending_user_review'
  | 'completed'
  | 'closed'
  | 'cancelled'; // deprecated
type TaskOrigin = 'backlog' | 'chat';
type BacklogStatus = 'not_started' | 'started' | 'complete' | 'closed';

interface Task {
  _id: Id<'chatroom_tasks'>;
  content: string;
  status: TaskStatus;
  origin?: TaskOrigin;
  createdAt: number;
  updatedAt: number;
  queuePosition: number;
  assignedTo?: string;
  backlog?: {
    status: BacklogStatus;
  };
}

interface TaskDetailModalProps {
  isOpen: boolean;
  task: Task | null;
  onClose: () => void;
  onEdit: (taskId: string, content: string) => Promise<void>;
  onDelete: (taskId: string) => Promise<void>;
  onForceComplete: (taskId: string) => Promise<void>;
  onMarkBacklogComplete?: (taskId: string) => Promise<void>;
  onCloseBacklog?: (taskId: string) => Promise<void>;
  onReopenBacklog?: (taskId: string) => Promise<void>;
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
    case 'pending_user_review':
      return {
        emoji: '🟣',
        label: 'Review',
        classes: 'bg-violet-500/15 text-violet-500 dark:bg-violet-400/15 dark:text-violet-400',
      };
    case 'completed':
      return {
        emoji: '✅',
        label: 'Completed',
        classes: 'bg-chatroom-status-success/15 text-chatroom-status-success',
      };
    case 'closed':
      return {
        emoji: '⚫',
        label: 'Closed',
        classes: 'bg-chatroom-text-muted/15 text-chatroom-text-muted',
      };
    case 'cancelled':
      return {
        emoji: '⚫',
        label: 'Cancelled',
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
  onForceComplete,
  onMarkBacklogComplete,
  onCloseBacklog,
  onReopenBacklog,
  isProtected = false,
}: TaskDetailModalProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [editedContent, setEditedContent] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'edit' | 'preview'>('edit');

  // Attached tasks context for adding to chat
  const { addTask, isTaskAttached, canAddMore } = useAttachedTasks();

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

  const handleMarkBacklogComplete = useCallback(async () => {
    if (!task || !onMarkBacklogComplete) return;
    setIsLoading(true);
    setError(null);
    try {
      await onMarkBacklogComplete(task._id);
      onClose();
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to mark as complete';
      setError(message);
    } finally {
      setIsLoading(false);
    }
  }, [task, onMarkBacklogComplete, onClose]);

  const handleCloseBacklog = useCallback(async () => {
    if (!task || !onCloseBacklog) return;
    setIsLoading(true);
    setError(null);
    try {
      await onCloseBacklog(task._id);
      onClose();
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to close task';
      setError(message);
    } finally {
      setIsLoading(false);
    }
  }, [task, onCloseBacklog, onClose]);

  const handleReopenBacklog = useCallback(async () => {
    if (!task || !onReopenBacklog) return;
    setIsLoading(true);
    setError(null);
    try {
      await onReopenBacklog(task._id);
      onClose();
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to reopen task';
      setError(message);
    } finally {
      setIsLoading(false);
    }
  }, [task, onReopenBacklog, onClose]);

  if (!isOpen || !task) {
    return null;
  }

  // Determine if this is a backlog-origin task
  const isBacklogOrigin = task.origin === 'backlog';

  // Determine backlog status for showing appropriate actions
  // Task is archived if status is completed or closed
  const isArchivedBacklog = task.status === 'completed' || task.status === 'closed';

  // Active backlog: backlog-origin task that is not archived
  const isActiveBacklog = isBacklogOrigin && !isArchivedBacklog;

  // Pending review items: tasks in pending_user_review status
  const isPendingReview = task.status === 'pending_user_review';

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
      {/* md breakpoint uses max-w-2xl (672px) for more comfortable editing on tablets */}
      <div className="fixed inset-x-2 top-16 bottom-2 md:inset-auto md:top-1/2 md:left-1/2 md:-translate-x-1/2 md:-translate-y-1/2 md:w-[95%] md:max-w-2xl md:max-h-[85vh] lg:max-w-5xl lg:max-h-[90vh] lg:w-[90%] bg-chatroom-bg-primary border-2 border-chatroom-border-strong z-[70] flex flex-col animate-in fade-in zoom-in-95 duration-200">
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
        <div className="flex-1 overflow-hidden min-h-0 flex flex-col">
          {isEditing ? (
            // Tab-based editor with Edit/Preview tabs
            <>
              {/* Tab Bar */}
              <div className="flex border-b-2 border-chatroom-border-strong bg-chatroom-bg-tertiary flex-shrink-0">
                <button
                  onClick={() => setActiveTab('edit')}
                  className={`px-4 py-2 text-[10px] font-bold uppercase tracking-widest transition-colors border-b-2 -mb-[2px] ${
                    activeTab === 'edit'
                      ? 'border-chatroom-accent text-chatroom-text-primary bg-chatroom-bg-primary'
                      : 'border-transparent text-chatroom-text-muted hover:text-chatroom-text-secondary'
                  }`}
                >
                  Edit
                </button>
                <button
                  onClick={() => setActiveTab('preview')}
                  className={`px-4 py-2 text-[10px] font-bold uppercase tracking-widest transition-colors border-b-2 -mb-[2px] ${
                    activeTab === 'preview'
                      ? 'border-chatroom-accent text-chatroom-text-primary bg-chatroom-bg-primary'
                      : 'border-transparent text-chatroom-text-muted hover:text-chatroom-text-secondary'
                  }`}
                >
                  Preview
                </button>
              </div>

              {/* Tab Content - min-h-[260px] ensures comfortable editing area */}
              <div className="flex-1 flex flex-col overflow-hidden min-h-[260px]">
                {activeTab === 'edit' ? (
                  // Edit Tab - Full width textarea that fills container
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
                ) : (
                  // Preview Tab - Read-only rendered markdown
                  <div className="h-full overflow-y-auto p-4 text-sm text-chatroom-text-primary prose dark:prose-invert prose-sm max-w-none prose-headings:font-bold prose-headings:mt-4 prose-headings:mb-2 prose-p:my-2 prose-code:bg-chatroom-bg-tertiary prose-code:px-1.5 prose-code:py-0.5 prose-code:text-chatroom-status-success prose-code:text-[0.9em] prose-pre:bg-chatroom-bg-tertiary prose-pre:border-2 prose-pre:border-chatroom-border prose-pre:my-3 prose-a:text-chatroom-status-info prose-a:no-underline hover:prose-a:text-chatroom-accent">
                    <Markdown remarkPlugins={[remarkGfm]}>
                      {editedContent || '*No content yet*'}
                    </Markdown>
                  </div>
                )}
              </div>
            </>
          ) : (
            // View mode - Read-only rendered markdown
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
                {/* Primary Actions - Always visible */}
                {/* Add to chat for backlog items and pending review items */}
                {(task.status === 'backlog' || task.status === 'pending_user_review') &&
                  isBacklogOrigin && (
                    <button
                      onClick={() => {
                        if (task) {
                          const added = addTask({ _id: task._id, content: task.content });
                          if (added) {
                            onClose();
                          }
                        }
                      }}
                      disabled={isLoading || isTaskAttached(task._id) || !canAddMore}
                      className="flex items-center gap-1 px-3 py-2 text-[10px] font-bold uppercase tracking-wide bg-chatroom-accent text-chatroom-bg-primary hover:bg-chatroom-text-secondary transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                      title={
                        isTaskAttached(task._id)
                          ? 'Already added to chat'
                          : !canAddMore
                            ? `Maximum ${MAX_ATTACHMENTS} attachments`
                            : isPendingReview
                              ? 'Add to chat for re-review'
                              : 'Add to chat'
                      }
                    >
                      <Plus size={12} />
                      {isTaskAttached(task._id) ? 'Added' : 'Add to Chat'}
                    </button>
                  )}

                {/* Force complete for active tasks */}
                {(task.status === 'in_progress' || task.status === 'pending') && (
                  <button
                    onClick={handleForceComplete}
                    disabled={isLoading}
                    className="flex items-center gap-1 px-3 py-2 text-[10px] font-bold uppercase tracking-wide border-2 border-chatroom-status-warning/30 text-chatroom-status-warning hover:bg-chatroom-status-warning/10 hover:border-chatroom-status-warning transition-colors"
                    title="Force complete this stuck task"
                  >
                    <StopCircle size={12} />
                    Force Complete
                  </button>
                )}

                {/* Spacer to push dropdown to right */}
                <div className="flex-1" />

                {/* Secondary Actions - In dropdown menu */}
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <button
                      disabled={isLoading}
                      className="flex items-center gap-1 px-3 py-2 text-[10px] font-bold uppercase tracking-wide border-2 border-chatroom-border text-chatroom-text-secondary hover:bg-chatroom-bg-hover hover:border-chatroom-border-strong hover:text-chatroom-text-primary transition-colors disabled:opacity-50"
                      title="More actions"
                    >
                      <MoreHorizontal size={14} />
                      Actions
                    </button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="min-w-[160px]">
                    {/* Edit action */}
                    <DropdownMenuItem
                      onClick={() => setIsEditing(true)}
                      className="flex items-center gap-2 cursor-pointer"
                    >
                      <Pencil size={14} />
                      Edit
                    </DropdownMenuItem>

                    {/* Backlog lifecycle actions */}
                    {isActiveBacklog && (
                      <>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem
                          onClick={handleMarkBacklogComplete}
                          className="flex items-center gap-2 cursor-pointer text-chatroom-status-success"
                        >
                          <CheckCircle size={14} />
                          Mark Complete
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          onClick={handleCloseBacklog}
                          className="flex items-center gap-2 cursor-pointer text-chatroom-text-muted"
                        >
                          <XCircle size={14} />
                          Close
                        </DropdownMenuItem>
                      </>
                    )}

                    {/* Reopen for archived */}
                    {isArchivedBacklog && (
                      <>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem
                          onClick={handleReopenBacklog}
                          className="flex items-center gap-2 cursor-pointer text-chatroom-status-info"
                        >
                          <RotateCcw size={14} />
                          Reopen
                        </DropdownMenuItem>
                      </>
                    )}

                    {/* Delete action - always at bottom, dangerous */}
                    <DropdownMenuSeparator />
                    <DropdownMenuItem
                      onClick={handleDelete}
                      className="flex items-center gap-2 cursor-pointer text-chatroom-status-error"
                    >
                      <Trash2 size={14} />
                      Delete
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </>
            )}
          </div>
        )}
      </div>
    </>
  );
}
