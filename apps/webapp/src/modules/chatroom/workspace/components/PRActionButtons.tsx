/**
 * PRActionButtons — shared PR action buttons (Merge Squash, Merge, Close).
 *
 * Used by both WorkspaceGitPanel and PRDetailModal.
 * Includes close confirmation, inline feedback, and onSuccess callback.
 */

'use client';

import { memo, useState, useEffect, useRef, useCallback } from 'react';

export type PRAction = 'merge_squash' | 'merge_no_squash' | 'close';

interface PRActionButtonsProps {
  onAction: (action: PRAction) => void;
  loading?: boolean;
  /** Called after a successful action trigger — consumers can close modals, etc. */
  onSuccess?: () => void;
}

export const PRActionButtons = memo(function PRActionButtons({
  onAction,
  loading,
  onSuccess,
}: PRActionButtonsProps) {
  const [confirmingClose, setConfirmingClose] = useState(false);
  const [showFeedback, setShowFeedback] = useState(false);
  const prevLoadingRef = useRef(loading);
  const confirmTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Detect when loading transitions from true → false (action completed)
  useEffect(() => {
    if (prevLoadingRef.current && !loading) {
      setShowFeedback(true);
      const timer = setTimeout(() => setShowFeedback(false), 2000);
      onSuccess?.();
      return () => clearTimeout(timer);
    }
    prevLoadingRef.current = loading;
  }, [loading, onSuccess]);

  // Auto-reset close confirmation after 3s
  useEffect(() => {
    if (confirmingClose) {
      confirmTimerRef.current = setTimeout(() => setConfirmingClose(false), 3000);
      return () => {
        if (confirmTimerRef.current) clearTimeout(confirmTimerRef.current);
      };
    }
  }, [confirmingClose]);

  const handleClose = useCallback(() => {
    if (confirmingClose) {
      setConfirmingClose(false);
      onAction('close');
    } else {
      setConfirmingClose(true);
    }
  }, [confirmingClose, onAction]);

  return (
    <div className="flex items-center gap-2">
      <button
        type="button"
        onClick={() => onAction('merge_squash')}
        disabled={loading}
        className="text-[10px] font-bold uppercase tracking-wider px-3 py-1.5 bg-chatroom-accent text-chatroom-bg-primary border border-chatroom-accent transition-all duration-100 hover:opacity-80 disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {loading ? '...' : 'Merge (Squash)'}
      </button>
      <button
        type="button"
        onClick={() => onAction('merge_no_squash')}
        disabled={loading}
        className="text-[10px] font-bold uppercase tracking-wider px-3 py-1.5 bg-chatroom-bg-primary text-chatroom-text-secondary border border-chatroom-border transition-all duration-100 hover:border-chatroom-accent hover:text-chatroom-accent disabled:opacity-50 disabled:cursor-not-allowed"
      >
        Merge
      </button>
      <button
        type="button"
        onClick={handleClose}
        disabled={loading}
        className={`text-[10px] font-bold uppercase tracking-wider px-3 py-1.5 border transition-all duration-100 disabled:opacity-50 disabled:cursor-not-allowed ${
          confirmingClose
            ? 'bg-red-500 dark:bg-red-600 text-white border-red-500 dark:border-red-600 hover:bg-red-600 dark:hover:bg-red-700'
            : 'bg-chatroom-bg-primary text-red-500 dark:text-red-400 border-red-300 dark:border-red-800 hover:bg-red-50 dark:hover:bg-red-950/20'
        }`}
      >
        {confirmingClose ? 'Confirm Close?' : 'Close'}
      </button>
      {showFeedback && (
        <span className="text-[10px] font-bold text-green-500 dark:text-green-400 uppercase tracking-wider animate-pulse">
          ✓ Action sent
        </span>
      )}
    </div>
  );
});
