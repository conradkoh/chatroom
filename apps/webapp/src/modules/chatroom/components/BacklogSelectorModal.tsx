'use client';

import type { Id } from '@workspace/backend/convex/_generated/dataModel';
import { X, Check } from 'lucide-react';
import React, { useState, useCallback, useEffect, memo } from 'react';

type BacklogStatus = 'not_started' | 'started' | 'complete' | 'closed';

interface Task {
  _id: Id<'chatroom_tasks'>;
  content: string;
  status: string;
  backlog?: {
    status: BacklogStatus;
  };
}

interface BacklogSelectorModalProps {
  isOpen: boolean;
  tasks: Task[];
  selectedTaskIds: Id<'chatroom_tasks'>[];
  onClose: () => void;
  onConfirm: (selectedTaskIds: Id<'chatroom_tasks'>[]) => void;
}

// Status badge helper
const getStatusBadge = (backlogStatus?: BacklogStatus) => {
  switch (backlogStatus) {
    case 'not_started':
      return {
        label: 'Not Started',
        classes: 'bg-chatroom-text-muted/15 text-chatroom-text-muted',
      };
    case 'started':
      return {
        label: 'Started',
        classes: 'bg-chatroom-status-info/15 text-chatroom-status-info',
      };
    case 'complete':
      return {
        label: 'Complete',
        classes: 'bg-chatroom-status-success/15 text-chatroom-status-success',
      };
    default:
      return {
        label: 'Backlog',
        classes: 'bg-chatroom-text-muted/15 text-chatroom-text-muted',
      };
  }
};

export const BacklogSelectorModal = memo(function BacklogSelectorModal({
  isOpen,
  tasks,
  selectedTaskIds,
  onClose,
  onConfirm,
}: BacklogSelectorModalProps) {
  // Local selection state (allows cancel without affecting parent)
  const [localSelected, setLocalSelected] = useState<Id<'chatroom_tasks'>[]>(selectedTaskIds);

  // Sync with parent when modal opens
  useEffect(() => {
    if (isOpen) {
      setLocalSelected(selectedTaskIds);
    }
  }, [isOpen, selectedTaskIds]);

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

  // Toggle task selection
  const toggleTask = useCallback((taskId: Id<'chatroom_tasks'>) => {
    setLocalSelected((prev) =>
      prev.includes(taskId) ? prev.filter((id) => id !== taskId) : [...prev, taskId]
    );
  }, []);

  // Confirm selection
  const handleConfirm = useCallback(() => {
    onConfirm(localSelected);
  }, [onConfirm, localSelected]);

  if (!isOpen) {
    return null;
  }

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/60 z-[60] backdrop-blur-sm"
        onClick={handleBackdropClick}
      />

      {/* Modal */}
      <div className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 max-w-md w-[90%] max-h-[70vh] bg-chatroom-bg-primary border-2 border-chatroom-border-strong z-[70] flex flex-col animate-in fade-in zoom-in-95 duration-200">
        {/* Header */}
        <div className="flex justify-between items-center p-4 border-b-2 border-chatroom-border-strong bg-chatroom-bg-surface flex-shrink-0">
          <span className="text-[10px] font-bold uppercase tracking-widest text-chatroom-text-primary">
            Attach Backlog ({localSelected.length} selected)
          </span>
          <button
            className="bg-transparent border-2 border-chatroom-border text-chatroom-text-secondary w-9 h-9 flex items-center justify-center cursor-pointer transition-all duration-100 hover:bg-chatroom-bg-hover hover:border-chatroom-border-strong hover:text-chatroom-text-primary"
            onClick={onClose}
            aria-label="Close"
          >
            <X size={20} />
          </button>
        </div>

        {/* Task List */}
        <div className="flex-1 overflow-y-auto">
          {tasks.length === 0 ? (
            <div className="p-4 text-center text-chatroom-text-muted text-xs">
              No backlog tasks available
            </div>
          ) : (
            tasks.map((task) => {
              const isSelected = localSelected.includes(task._id);
              const badge = getStatusBadge(task.backlog?.status);

              return (
                <label
                  key={task._id}
                  className={`flex items-start gap-3 p-3 border-b border-chatroom-border last:border-b-0 cursor-pointer transition-colors ${
                    isSelected ? 'bg-chatroom-accent/10' : 'hover:bg-chatroom-bg-hover'
                  }`}
                >
                  {/* Custom Checkbox */}
                  <div
                    className={`w-4 h-4 flex-shrink-0 mt-0.5 border-2 flex items-center justify-center transition-colors ${
                      isSelected
                        ? 'bg-chatroom-accent border-chatroom-accent'
                        : 'border-chatroom-border bg-chatroom-bg-primary'
                    }`}
                  >
                    {isSelected && <Check size={10} className="text-chatroom-bg-primary" />}
                  </div>
                  <input
                    type="checkbox"
                    checked={isSelected}
                    onChange={() => toggleTask(task._id)}
                    className="sr-only"
                  />

                  {/* Task Content */}
                  <div className="flex-1 min-w-0">
                    <div className="text-xs text-chatroom-text-primary line-clamp-2">
                      {task.content}
                    </div>
                    <span
                      className={`inline-block mt-1 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide ${badge.classes}`}
                    >
                      {badge.label}
                    </span>
                  </div>
                </label>
              );
            })
          )}
        </div>

        {/* Footer */}
        <div className="p-3 border-t-2 border-chatroom-border-strong bg-chatroom-bg-surface flex justify-end gap-2 flex-shrink-0">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 text-[10px] font-bold uppercase tracking-wide text-chatroom-text-muted hover:text-chatroom-text-primary transition-colors"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleConfirm}
            className="px-4 py-2 text-[10px] font-bold uppercase tracking-wide bg-chatroom-accent text-chatroom-bg-primary hover:bg-chatroom-text-secondary transition-colors"
          >
            Done
          </button>
        </div>
      </div>
    </>
  );
});
