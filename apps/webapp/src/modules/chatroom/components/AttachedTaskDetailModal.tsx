'use client';

import type { TaskStatus } from '@workspace/backend/convex/lib/taskStateMachine';
import { X } from 'lucide-react';
import React, { useEffect } from 'react';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

import { baseMarkdownComponents } from './markdown-utils';
import { getBacklogStatusBadge } from './backlog-utils';

interface AttachedTask {
  _id: string;
  content: string;
  backlogStatus?: TaskStatus;
}

interface AttachedTaskDetailModalProps {
  isOpen: boolean;
  task: AttachedTask | null;
  onClose: () => void;
}

/**
 * Read-only modal for viewing attached task details from message history.
 * Uses a slide-in side panel design consistent with FeatureDetailModal.
 */
export function AttachedTaskDetailModal({ isOpen, task, onClose }: AttachedTaskDetailModalProps) {
  // Close on Escape key
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };

    if (isOpen) {
      window.addEventListener('keydown', handleKeyDown);
    }

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen, onClose]);

  if (!isOpen || !task) return null;

  const getStatusBadgeForAttachedTask = (status?: string) => {
    // Use shared backlog status badge for backlog-specific statuses
    if (status === 'backlog' || status === 'pending_user_review' || status === 'closed') {
      return getBacklogStatusBadge(status);
    }
    // Fallback for task-level statuses
    switch (status) {
      case 'in_progress':
        return {
          label: 'In Progress',
          classes: 'bg-chatroom-status-info/15 text-chatroom-status-info',
        };
      case 'pending':
        return {
          label: 'Pending',
          classes: 'bg-chatroom-status-success/15 text-chatroom-status-success',
        };
      case 'acknowledged':
        return {
          label: 'Acknowledged',
          classes: 'bg-chatroom-status-success/15 text-chatroom-status-success',
        };
      case 'completed':
        return {
          label: 'Completed',
          classes: 'bg-chatroom-status-success/15 text-chatroom-status-success',
        };
      default:
        return {
          label: 'Backlog',
          classes: 'bg-chatroom-text-muted/15 text-chatroom-text-muted',
        };
    }
  };

  const statusBadge = getStatusBadgeForAttachedTask(task.backlogStatus);

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-40 bg-black/20 transition-opacity"
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Side Panel */}
      <div className="fixed inset-y-0 right-0 z-50 w-full max-w-md bg-chatroom-bg-primary border-l-2 border-chatroom-border shadow-xl flex flex-col animate-in slide-in-from-right duration-200">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b-2 border-chatroom-border bg-chatroom-bg-primary">
          <div className="flex items-center gap-3">
            <span className="text-sm font-bold text-chatroom-text-primary">Attached Task</span>
            <span
              className={`px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide ${statusBadge.classes}`}
            >
              {statusBadge.label}
            </span>
          </div>
          <button
            onClick={onClose}
            className="text-chatroom-text-muted hover:text-chatroom-text-primary transition-colors"
            aria-label="Close"
          >
            <X size={18} />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-4">
          <div className="prose dark:prose-invert prose-sm max-w-none prose-headings:font-semibold prose-headings:mt-4 prose-headings:mb-2 prose-p:my-2 prose-code:bg-chatroom-bg-tertiary prose-code:px-1.5 prose-code:py-0.5 prose-code:text-chatroom-status-success prose-code:text-[0.9em] prose-pre:bg-chatroom-bg-tertiary prose-pre:border-2 prose-pre:border-chatroom-border prose-pre:my-3 prose-pre:overflow-x-auto prose-a:text-chatroom-status-info prose-a:no-underline hover:prose-a:text-chatroom-accent prose-ul:my-2 prose-ol:my-2 prose-li:my-0 text-chatroom-text-primary">
            <Markdown remarkPlugins={[remarkGfm]} components={baseMarkdownComponents}>
              {task.content}
            </Markdown>
          </div>
        </div>
      </div>
    </>
  );
}
