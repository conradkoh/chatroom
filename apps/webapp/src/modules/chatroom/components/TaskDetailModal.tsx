'use client';

import type { Id } from '@workspace/backend/convex/_generated/dataModel';
import { Check, Paperclip, MoreHorizontal, Pencil, StopCircle, Trash2, X } from 'lucide-react';
import React, { useState, useCallback, useEffect } from 'react';
import Markdown from 'react-markdown';
import remarkBreaks from 'remark-breaks';
import remarkGfm from 'remark-gfm';

import { baseMarkdownComponents, taskDetailProseClassNames } from './markdown-utils';
import type { TaskStatus, TaskOrigin } from '../../../domain/entities/task';
import { useAttachments } from '../context/AttachmentsContext';

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  FixedModal,
  FixedModalBody,
  FixedModalContent,
  FixedModalHeader,
} from '@/components/ui/fixed-modal';

interface Task {
  _id: Id<'chatroom_tasks'>;
  content: string;
  status: TaskStatus;
  origin?: TaskOrigin;
  createdAt: number;
  updatedAt: number;
  queuePosition: number;
  assignedTo?: string;
}

interface TaskDetailModalProps {
  isOpen: boolean;
  task: Task | null;
  onClose: () => void;
  onEdit: (taskId: string, content: string) => Promise<void>;
  onDelete: (taskId: string) => Promise<void>;
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
    case 'acknowledged':
      return {
        emoji: '🟢',
        label: 'Acknowledged',
        classes: 'bg-chatroom-status-success/15 text-chatroom-status-success',
      };
    case 'in_progress':
      return {
        emoji: '🔵',
        label: 'In Progress',
        classes: 'bg-chatroom-status-info/15 text-chatroom-status-info',
      };
    case 'completed':
      return {
        emoji: '✅',
        label: 'Completed',
        classes: 'bg-chatroom-status-success/15 text-chatroom-status-success',
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
  isProtected = false,
}: TaskDetailModalProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [editedContent, setEditedContent] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'edit' | 'preview'>('edit');

  // Attachments context for adding to chat
  const { add, isAttached, canAddMore } = useAttachments();

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

  /** Escape / header close / backdrop (when not editing): exit edit first, then close modal. */
  const dismissFromChrome = useCallback(() => {
    if (isEditing) {
      setIsEditing(false);
    } else {
      onClose();
    }
  }, [isEditing, onClose]);

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

  if (!isOpen || !task) {
    return null;
  }

  const badge = getStatusBadge(task.status);

  return (
    <FixedModal
      isOpen={isOpen}
      onClose={dismissFromChrome}
      maxWidth="max-w-5xl"
      closeOnBackdrop={!isEditing}
      className="sm:h-[85vh] sm:max-h-[90vh]"
    >
      <FixedModalContent>
        <FixedModalHeader onClose={dismissFromChrome} className="py-4">
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
        </FixedModalHeader>

        <FixedModalBody className="flex flex-col min-h-0 p-0">
          <div className="flex-1 overflow-hidden min-h-0 flex flex-col">
            {isEditing ? (
              <>
                {/* Tab Bar */}
                <div className="flex border-b-2 border-chatroom-border-strong bg-chatroom-bg-tertiary flex-shrink-0">
                  <button
                    type="button"
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
                    type="button"
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
                    <textarea
                      value={editedContent}
                      onChange={(e) => setEditedContent(e.target.value)}
                      onKeyDown={(e) => {
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
                    <div
                      className={`h-full overflow-y-auto p-4 text-sm ${taskDetailProseClassNames}`}
                    >
                      <Markdown
                        remarkPlugins={[remarkGfm, remarkBreaks]}
                        components={baseMarkdownComponents}
                      >
                        {editedContent || '*No content yet*'}
                      </Markdown>
                    </div>
                  )}
                </div>
              </>
            ) : (
              <div className={`h-full overflow-y-auto p-4 text-sm ${taskDetailProseClassNames}`}>
                <Markdown
                  remarkPlugins={[remarkGfm, remarkBreaks]}
                  components={baseMarkdownComponents}
                >
                  {task.content}
                </Markdown>
              </div>
            )}
          </div>
        </FixedModalBody>

        {error && (
          <div className="px-4 py-2 bg-chatroom-status-error/10 border-t-2 border-chatroom-status-error/30 flex-shrink-0">
            <p className="text-xs text-chatroom-status-error">{error}</p>
          </div>
        )}

        {!isProtected && (
          <div className="p-4 border-t-2 border-chatroom-border-strong bg-chatroom-bg-surface flex items-center gap-2 flex-shrink-0">
            {isEditing ? (
              <>
                <button
                  type="button"
                  onClick={handleSave}
                  disabled={isLoading || !editedContent.trim()}
                  className="flex items-center gap-1 px-3 py-2 text-[10px] font-bold uppercase tracking-wide bg-chatroom-accent text-chatroom-bg-primary hover:bg-chatroom-text-secondary disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                >
                  <Check size={12} />
                  Save
                </button>
                <button
                  type="button"
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
                {(task.status === 'in_progress' ||
                  task.status === 'pending' ||
                  task.status === 'acknowledged') && (
                  <button
                    type="button"
                    onClick={handleForceComplete}
                    disabled={isLoading}
                    className="flex items-center gap-1 px-3 py-2 text-[10px] font-bold uppercase tracking-wide border-2 border-chatroom-status-warning/30 text-chatroom-status-warning hover:bg-chatroom-status-warning/10 hover:border-chatroom-status-warning transition-colors"
                    title="Force complete this stuck task"
                  >
                    <StopCircle size={12} />
                    Force Complete
                  </button>
                )}

                <div className="flex-1" />

                <DropdownMenu modal={false}>
                  <DropdownMenuTrigger asChild>
                    <button
                      type="button"
                      disabled={isLoading}
                      className="flex items-center gap-1 px-3 py-2 text-[10px] font-bold uppercase tracking-wide border-2 border-chatroom-border text-chatroom-text-secondary hover:bg-chatroom-bg-hover hover:border-chatroom-border-strong hover:text-chatroom-text-primary transition-colors disabled:opacity-50"
                      title="More actions"
                    >
                      <MoreHorizontal size={14} />
                      Actions
                    </button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="min-w-[160px]">
                    <DropdownMenuItem
                      onClick={() => setIsEditing(true)}
                      className="flex items-center gap-2 cursor-pointer"
                    >
                      <Pencil size={14} />
                      Edit
                    </DropdownMenuItem>

                    <DropdownMenuItem
                      onClick={() => {
                        if (task) {
                          const added = add({ type: 'task', id: task._id, content: task.content });
                          if (added) {
                            onClose();
                          }
                        }
                      }}
                      disabled={isAttached('task', task._id) || !canAddMore}
                      className="flex items-center gap-2 cursor-pointer"
                    >
                      <Paperclip size={14} />
                      {isAttached('task', task._id) ? 'Already Attached' : 'Attach to Context'}
                    </DropdownMenuItem>

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
      </FixedModalContent>
    </FixedModal>
  );
}
