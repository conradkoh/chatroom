'use client';

import { api } from '@workspace/backend/convex/_generated/api';
import type { Id } from '@workspace/backend/convex/_generated/dataModel';
import { useSessionQuery } from 'convex-helpers/react/sessions';
import { X, Loader2, Clock } from 'lucide-react';
import { memo, useCallback, useEffect, useRef } from 'react';

interface ProgressMessage {
  _id: string;
  content: string;
  senderRole: string;
  _creationTime: number;
}

interface ProgressTimelineModalProps {
  isOpen: boolean;
  chatroomId: string;
  taskId: string | null;
  taskTitle?: string;
  onClose: () => void;
}

function formatTime(timestamp: number): string {
  const date = new Date(timestamp);
  return date.toLocaleTimeString('en-US', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

function formatRelativeTime(timestamp: number): string {
  const now = Date.now();
  const diff = now - timestamp;
  const seconds = Math.floor(diff / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);

  if (seconds < 60) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  if (hours < 24) return `${hours}h ago`;
  return formatTime(timestamp);
}

export const ProgressTimelineModal = memo(function ProgressTimelineModal({
  isOpen,
  chatroomId,
  taskId,
  taskTitle,
  onClose,
}: ProgressTimelineModalProps) {
  const modalRef = useRef<HTMLDivElement>(null);

  // Fetch progress messages for the task
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const chatroomApi = api as any;
  const progressMessages = useSessionQuery(
    chatroomApi.messages.getProgressForTask,
    taskId
      ? {
          chatroomId: chatroomId as Id<'chatroom_rooms'>,
          taskId: taskId as Id<'chatroom_tasks'>,
        }
      : 'skip'
  ) as ProgressMessage[] | undefined;

  // Close on escape key
  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };

    if (isOpen) {
      document.addEventListener('keydown', handleEscape);
      return () => document.removeEventListener('keydown', handleEscape);
    }
  }, [isOpen, onClose]);

  // Close on backdrop click
  const handleBackdropClick = useCallback(
    (e: React.MouseEvent) => {
      if (e.target === e.currentTarget) {
        onClose();
      }
    },
    [onClose]
  );

  if (!isOpen) return null;

  const isLoading = progressMessages === undefined;
  const hasProgress = progressMessages && progressMessages.length > 0;

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 backdrop-blur-sm animate-in fade-in duration-200"
      onClick={handleBackdropClick}
    >
      <div
        ref={modalRef}
        className="w-full max-w-lg max-h-[70vh] bg-chatroom-bg-surface border-t-2 border-chatroom-border-strong rounded-t-xl shadow-2xl animate-in slide-in-from-bottom duration-300 flex flex-col"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-chatroom-border">
          <div className="flex items-center gap-2">
            <Clock size={16} className="text-chatroom-status-info" />
            <h3 className="text-sm font-semibold text-chatroom-text-primary">Progress Timeline</h3>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 hover:bg-chatroom-bg-hover rounded transition-colors"
            aria-label="Close"
          >
            <X size={18} className="text-chatroom-text-muted" />
          </button>
        </div>

        {/* Task title */}
        {taskTitle && (
          <div className="px-4 py-2 border-b border-chatroom-border bg-chatroom-bg-tertiary">
            <p className="text-xs text-chatroom-text-secondary truncate">{taskTitle}</p>
          </div>
        )}

        {/* Timeline content */}
        <div className="flex-1 overflow-y-auto p-4">
          {isLoading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 size={24} className="animate-spin text-chatroom-status-info" />
            </div>
          ) : !hasProgress ? (
            <div className="flex flex-col items-center justify-center py-8 text-chatroom-text-muted">
              <Clock size={32} className="mb-2 opacity-50" />
              <p className="text-sm">No progress updates yet</p>
            </div>
          ) : (
            <div className="relative">
              {/* Timeline line */}
              <div className="absolute left-[7px] top-2 bottom-2 w-0.5 bg-chatroom-border" />

              {/* Timeline items */}
              <div className="space-y-4">
                {progressMessages.map((progress, index) => {
                  const isLatest = index === progressMessages.length - 1;
                  return (
                    <div key={progress._id} className="relative pl-6">
                      {/* Timeline dot */}
                      <div
                        className={`absolute left-0 top-1 w-[15px] h-[15px] rounded-full border-2 ${
                          isLatest
                            ? 'bg-chatroom-status-info border-chatroom-status-info animate-pulse'
                            : 'bg-chatroom-bg-surface border-chatroom-border'
                        }`}
                      />

                      {/* Content */}
                      <div
                        className={`p-3 rounded-lg ${
                          isLatest
                            ? 'bg-chatroom-status-info/10 border border-chatroom-status-info/30'
                            : 'bg-chatroom-bg-tertiary'
                        }`}
                      >
                        <div className="flex items-center justify-between mb-1">
                          <span className="text-[10px] font-bold uppercase tracking-wide text-chatroom-text-muted">
                            {progress.senderRole}
                          </span>
                          <span className="text-[10px] text-chatroom-text-muted">
                            {formatRelativeTime(progress._creationTime)}
                          </span>
                        </div>
                        <p className="text-sm text-chatroom-text-primary">{progress.content}</p>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-4 py-2 border-t border-chatroom-border bg-chatroom-bg-tertiary">
          <p className="text-[10px] text-chatroom-text-muted text-center">
            {hasProgress
              ? `${progressMessages.length} update${progressMessages.length !== 1 ? 's' : ''}`
              : 'Waiting for updates...'}
          </p>
        </div>
      </div>
    </div>
  );
});
