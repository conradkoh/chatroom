'use client';

import { ClipboardCheck, X } from 'lucide-react';
import React, { useCallback } from 'react';

import type { BacklogItem } from '../../backlog';
import type { Task } from '../types';
import { PendingReviewModalItem } from './PendingReviewModalItem';
import { PendingReviewBacklogModalItem } from './PendingReviewBacklogModalItem';

export interface PendingReviewModalProps {
  tasks?: Task[];
  backlogItems: BacklogItem[];
  onClose: () => void;
  onTaskClick: (task: Task) => void;
  onBacklogItemClick: (item: BacklogItem) => void;
}

export function PendingReviewModal({
  tasks = [],
  backlogItems,
  onClose,
  onTaskClick,
  onBacklogItemClick,
}: PendingReviewModalProps) {
  // Handle Escape key
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    },
    [onClose]
  );

  React.useEffect(() => {
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [handleKeyDown]);

  // Handle backdrop click
  const handleBackdropClick = useCallback(
    (e: React.MouseEvent) => {
      if (e.target === e.currentTarget) {
        onClose();
      }
    },
    [onClose]
  );

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/60 z-40 backdrop-blur-sm"
        onClick={handleBackdropClick}
      />

      {/* Modal */}
      <div className="fixed inset-x-2 top-16 bottom-2 md:inset-auto md:top-1/2 md:left-1/2 md:-translate-x-1/2 md:-translate-y-1/2 md:w-[95%] md:max-w-xl md:max-h-[70vh] bg-chatroom-bg-primary border-2 border-chatroom-border-strong z-50 flex flex-col animate-in fade-in zoom-in-95 duration-200">
        {/* Header */}
        <div className="flex justify-between items-center p-4 border-b-2 border-chatroom-border-strong bg-chatroom-bg-surface flex-shrink-0">
          <div className="flex items-center gap-2">
            <ClipboardCheck size={16} className="text-violet-500 dark:text-violet-400" />
            <span className="text-sm font-bold uppercase tracking-wide text-chatroom-text-primary">
              Pending Review ({tasks.length + backlogItems.length})
            </span>
          </div>
          <button
            className="bg-transparent border-2 border-chatroom-border text-chatroom-text-secondary w-9 h-9 flex items-center justify-center cursor-pointer transition-all duration-100 hover:bg-chatroom-bg-hover hover:border-chatroom-border-strong hover:text-chatroom-text-primary"
            onClick={onClose}
            aria-label="Close"
          >
            <X size={20} />
          </button>
        </div>

        {/* Task List */}
        <div className="flex-1 overflow-y-auto min-h-0">
          {tasks.length === 0 && backlogItems.length === 0 ? (
            <div className="p-8 text-center text-chatroom-text-muted text-sm">
              No tasks pending review
            </div>
          ) : (
            <>
              {tasks.map((task) => (
                <PendingReviewModalItem
                  key={task._id}
                  task={task}
                  onClick={() => onTaskClick(task)}
                />
              ))}
              {backlogItems.map((item) => (
                <PendingReviewBacklogModalItem
                  key={item._id}
                  item={item}
                  onClick={() => onBacklogItemClick(item)}
                />
              ))}
            </>
          )}
        </div>
      </div>
    </>
  );
}
