/**
 * PRActionButtons — shared PR action buttons (Merge Squash, Merge, Close).
 *
 * Used by both WorkspaceGitPanel and PRDetailModal.
 */

'use client';

import { memo } from 'react';

export type PRAction = 'merge_squash' | 'merge_no_squash' | 'close';

interface PRActionButtonsProps {
  onAction: (action: PRAction) => void;
  loading?: boolean;
}

export const PRActionButtons = memo(function PRActionButtons({
  onAction,
  loading,
}: PRActionButtonsProps) {
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
        onClick={() => onAction('close')}
        disabled={loading}
        className="text-[10px] font-bold uppercase tracking-wider px-3 py-1.5 bg-chatroom-bg-primary text-red-500 dark:text-red-400 border border-red-300 dark:border-red-800 transition-all duration-100 hover:bg-red-50 dark:hover:bg-red-950/20 disabled:opacity-50 disabled:cursor-not-allowed"
      >
        Close
      </button>
    </div>
  );
});
