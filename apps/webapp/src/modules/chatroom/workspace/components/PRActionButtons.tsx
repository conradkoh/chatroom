/**
 * PRActionButtons — shared PR action buttons (Merge Squash, Merge, Close).
 *
 * Used by WorkspaceGitPanel.
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
  /** Error message to display after a failed action — cleared on next action */
  error?: string | null;
}

const SENT_FEEDBACK_MS = 1000;
const ERROR_FEEDBACK_MS = 4000;

export const PRActionButtons = memo(function PRActionButtons({
  onAction,
  loading,
  onSuccess,
  error,
}: PRActionButtonsProps) {
  const [confirmingClose, setConfirmingClose] = useState(false);
  const [lastAction, setLastAction] = useState<PRAction | null>(null);
  const [sentAction, setSentAction] = useState<PRAction | null>(null);
  const [showError, setShowError] = useState(false);
  const prevLoadingRef = useRef(loading);
  const confirmTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const sentTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const errorTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearSentTimer = useCallback(() => {
    if (sentTimerRef.current) {
      clearTimeout(sentTimerRef.current);
      sentTimerRef.current = null;
    }
  }, []);

  const clearErrorTimer = useCallback(() => {
    if (errorTimerRef.current) {
      clearTimeout(errorTimerRef.current);
      errorTimerRef.current = null;
    }
  }, []);

  // Detect when loading transitions from true → false (action completed)
  useEffect(() => {
    if (prevLoadingRef.current && !loading) {
      if (error) {
        setShowError(true);
        clearErrorTimer();
        errorTimerRef.current = setTimeout(() => setShowError(false), ERROR_FEEDBACK_MS);
      } else if (lastAction) {
        setSentAction(lastAction);
        clearSentTimer();
        sentTimerRef.current = setTimeout(() => setSentAction(null), SENT_FEEDBACK_MS);
        onSuccess?.();
      }
    }
    prevLoadingRef.current = loading;
  }, [loading, onSuccess, error, lastAction, clearSentTimer, clearErrorTimer]);

  // Clear feedback when a new action starts (loading goes true)
  useEffect(() => {
    if (loading) {
      setShowError(false);
      setSentAction(null);
      clearSentTimer();
      clearErrorTimer();
    }
  }, [loading, clearSentTimer, clearErrorTimer]);

  useEffect(() => {
    return () => {
      clearSentTimer();
      clearErrorTimer();
      if (confirmTimerRef.current) clearTimeout(confirmTimerRef.current);
    };
  }, [clearSentTimer, clearErrorTimer]);

  // Auto-reset close confirmation after 3s
  useEffect(() => {
    if (confirmingClose) {
      confirmTimerRef.current = setTimeout(() => setConfirmingClose(false), 3000);
      return () => {
        if (confirmTimerRef.current) clearTimeout(confirmTimerRef.current);
      };
    }
  }, [confirmingClose]);

  const triggerAction = useCallback(
    (action: PRAction) => {
      setLastAction(action);
      onAction(action);
    },
    [onAction],
  );

  const handleClose = useCallback(() => {
    if (confirmingClose) {
      setConfirmingClose(false);
      triggerAction('close');
    } else {
      setConfirmingClose(true);
    }
  }, [confirmingClose, triggerAction]);

  const labelFor = (action: PRAction, defaultLabel: string) => {
    if (loading && lastAction === action) return '...';
    if (sentAction === action) return 'SENT!';
    return defaultLabel;
  };

  return (
    <div className="flex items-center gap-2">
      <button
        type="button"
        onClick={() => triggerAction('merge_squash')}
        disabled={loading}
        className="text-[10px] font-bold uppercase tracking-wider px-3 py-1.5 bg-chatroom-accent text-chatroom-bg-primary border border-chatroom-accent transition-all duration-100 hover:opacity-80 disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {labelFor('merge_squash', 'Merge (Squash)')}
      </button>
      <button
        type="button"
        onClick={() => triggerAction('merge_no_squash')}
        disabled={loading}
        className="text-[10px] font-bold uppercase tracking-wider px-3 py-1.5 bg-chatroom-bg-primary text-chatroom-text-secondary border border-chatroom-border transition-all duration-100 hover:border-chatroom-accent hover:text-chatroom-accent disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {labelFor('merge_no_squash', 'Merge')}
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
        {loading && lastAction === 'close'
          ? '...'
          : sentAction === 'close'
            ? 'SENT!'
            : confirmingClose
              ? 'Confirm Close?'
              : 'Close'}
      </button>
      {showError && error && (
        <span
          className="text-[10px] font-bold text-red-500 dark:text-red-400 uppercase tracking-wider truncate max-w-[200px]"
          title={error}
        >
          ✗ {error}
        </span>
      )}
    </div>
  );
});
