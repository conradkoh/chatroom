'use client';

import { api } from '@workspace/backend/convex/_generated/api';
import type { Id } from '@workspace/backend/convex/_generated/dataModel';
import { useSessionMutation } from 'convex-helpers/react/sessions';
import {
  AlertCircle,
  Check,
  Paperclip,
  MoreHorizontal,
  RefreshCw,
  StopCircle,
  Trash2,
  X,
} from 'lucide-react';
import React, { useState, useCallback } from 'react';
import Markdown from 'react-markdown';
import { toast } from 'sonner';

import { chatroomRemarkPlugins } from './chatroomRemarkPlugins';
import { DetailModalMarkdownSurface, detailModalMarkdownProseClassNames } from './detail-modal';
import { RichTextEditor, isInteractiveClickTarget } from './detail-modal-shared';
import { HandoffStructuredContent } from './HandoffStructuredContent';
import { modalMarkdownComponents, taskDetailProseClassNames } from './markdown-utils';
import { useAttachments } from '../attachments';
import { getStatusBadge } from './WorkQueue/utils';
import type { TaskStatus, TaskOrigin } from '../../../domain/entities/task';

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
import { cn } from '@/lib/utils';

interface Task {
  _id: Id<'chatroom_tasks'>;
  content: string;
  status: TaskStatus;
  origin?: TaskOrigin;
  createdAt: number;
  updatedAt: number;
  queuePosition: number;
  assignedTo?: string;
  deliveryFailure?: {
    reason:
      | 'no_agent_config'
      | 'unsupported_harness'
      | 'injection_not_confirmed'
      | 'task_not_deliverable'
      | 'assigned_elsewhere'
      | 'redelivery_exhausted';
    occurredAt: number;
  };
}

const canRedeliverTask = (task: Task | null): task is Task =>
  task !== null && (task.status === 'pending' || task.status === 'acknowledged');

const notifyRedeliveryResult = (skipped: boolean): void => {
  if (skipped) toast.info('Task delivery is already pending');
  else toast.success('Task queued for delivery');
};

interface TaskDetailModalProps {
  isOpen: boolean;
  task: Task | null;
  onClose: () => void;
  onEdit: (taskId: string, content: string) => Promise<void>;
  onDelete: (taskId: string) => Promise<void>;
  onForceComplete: (taskId: string) => Promise<void>;
  isProtected?: boolean;
}

export function TaskDetailModal({
  isOpen,
  task,
  onClose,
  onEdit,
  onDelete,
  onForceComplete,
  isProtected = false,
}: TaskDetailModalProps) {
  if (!isOpen || !task) return null;
  return (
    <TaskDetailForm
      key={task._id}
      isOpen
      task={task}
      onClose={onClose}
      onEdit={onEdit}
      onDelete={onDelete}
      onForceComplete={onForceComplete}
      isProtected={isProtected}
    />
  );
}

function TaskDetailForm({
  isOpen,
  task,
  onClose,
  onEdit,
  onDelete,
  onForceComplete,
  isProtected = false,
}: Omit<TaskDetailModalProps, 'task'> & {
  task: NonNullable<TaskDetailModalProps['task']>;
}) {
  const [isEditing, setIsEditing] = useState(false);
  const [editedContent, setEditedContent] = useState(task.content);
  const [initialClickCoords, setInitialClickCoords] = useState<{
    left: number;
    top: number;
  } | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const redeliverTask = useSessionMutation(api.tasks.redeliverTask);

  // Attachments context for adding to chat
  const { add, isAttached, canAddMore } = useAttachments();

  /** Escape / header close / backdrop (when not editing): exit edit first, then close modal. */
  const cancelEdit = useCallback(() => {
    setEditedContent(task?.content ?? '');
    setIsEditing(false);
    setInitialClickCoords(null);
  }, [task]);

  const dismissFromChrome = useCallback(() => {
    if (!isEditing) return onClose();
    cancelEdit();
  }, [isEditing, cancelEdit, onClose]);

  const handleSave = useCallback(async () => {
    if (!task || !editedContent.trim()) return;
    setIsLoading(true);
    setError(null);
    try {
      await onEdit(task._id, editedContent.trim());
      setIsEditing(false);
      setInitialClickCoords(null);
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

  const handleRedeliver = useCallback(async () => {
    if (!canRedeliverTask(task)) return;
    setIsLoading(true);
    setError(null);
    try {
      const result = await redeliverTask({ taskId: task._id });
      notifyRedeliveryResult(result.skipped);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to redeliver task';
      setError(message);
      toast.error(message);
    } finally {
      setIsLoading(false);
    }
  }, [task, redeliverTask]);

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
  const taskModalProseClassNames = cn(
    detailModalMarkdownProseClassNames,
    taskDetailProseClassNames
  );

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
            {task.deliveryFailure && (
              <span
                className="inline-flex items-center gap-1 text-[10px] text-chatroom-status-warning"
                title={`Delivery failed: ${task.deliveryFailure.reason}`}
              >
                <AlertCircle size={11} />
                Delivery failed: {task.deliveryFailure.reason.replaceAll('_', ' ')}
              </span>
            )}
          </div>
        </FixedModalHeader>

        <FixedModalBody className="flex flex-col min-h-0 p-0">
          <div className="flex-1 overflow-hidden min-h-0 flex flex-col">
            {isEditing ? (
              <RichTextEditor
                value={editedContent}
                onChange={setEditedContent}
                placeholder="Write your markdown here..."
                onCmdEnter={handleSave}
                initialClickCoords={initialClickCoords}
                className="flex-1 flex flex-col min-h-0"
                proseClassName={taskModalProseClassNames}
              />
            ) : (
              <DetailModalMarkdownSurface
                data-testid="task-detail-view-body"
                onClick={
                  !isProtected
                    ? (e) => {
                        if (isInteractiveClickTarget(e.target)) return;
                        setInitialClickCoords({ left: e.clientX, top: e.clientY });
                        setIsEditing(true);
                      }
                    : undefined
                }
                onKeyDown={
                  !isProtected
                    ? (e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          setInitialClickCoords(null);
                          setIsEditing(true);
                        }
                      }
                    : undefined
                }
                role={!isProtected ? 'button' : undefined}
                tabIndex={!isProtected ? 0 : undefined}
                interactive={!isProtected}
                proseClassName={taskModalProseClassNames}
              >
                <HandoffStructuredContent
                  content={task.content}
                  variant="detail"
                  fallback={
                    <Markdown
                      remarkPlugins={chatroomRemarkPlugins}
                      components={modalMarkdownComponents}
                    >
                      {task.content}
                    </Markdown>
                  }
                />
              </DetailModalMarkdownSurface>
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
                  onClick={cancelEdit}
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
                  <DropdownMenuTrigger
                    type="button"
                    disabled={isLoading}
                    className="flex items-center gap-1 px-3 py-2 text-[10px] font-bold uppercase tracking-wide border-2 border-chatroom-border text-chatroom-text-secondary hover:bg-chatroom-bg-hover hover:border-chatroom-border-strong hover:text-chatroom-text-primary transition-colors disabled:opacity-50"
                    title="More actions"
                  >
                    <MoreHorizontal size={14} />
                    Actions
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="min-w-[160px]">
                    {(task.status === 'pending' || task.status === 'acknowledged') && (
                      <DropdownMenuItem
                        onClick={handleRedeliver}
                        disabled={isLoading}
                        className="flex items-center gap-2 cursor-pointer"
                      >
                        <RefreshCw size={14} />
                        Redeliver task
                      </DropdownMenuItem>
                    )}
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
                    {(task.status === 'pending' ||
                      task.status === 'acknowledged' ||
                      task.status === 'in_progress') && (
                      <DropdownMenuItem
                        onClick={handleDelete}
                        className="flex items-center gap-2 cursor-pointer text-chatroom-status-error"
                      >
                        <Trash2 size={14} />
                        Delete
                      </DropdownMenuItem>
                    )}
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
