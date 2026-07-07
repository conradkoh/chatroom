'use client';

import { FolderOpen, Loader2 } from 'lucide-react';
import { memo } from 'react';

interface SetupFolderPickerFieldProps {
  selectedPath: string;
  onPathChange: (path: string) => void;
  placeholder: string;
  disabled: boolean;
  isPending: boolean;
  isConfirming: boolean;
  isTimedOut: boolean;
  requestId: string | null;
  machineDisplayName: string | null;
  onBrowse: () => void;
  onRetryAfterTimeout: () => void;
}

export const SetupFolderPickerField = memo(function SetupFolderPickerField({
  selectedPath,
  onPathChange,
  placeholder,
  disabled,
  isPending,
  isConfirming,
  isTimedOut,
  requestId,
  machineDisplayName,
  onBrowse,
  onRetryAfterTimeout,
}: SetupFolderPickerFieldProps) {
  return (
    <div>
      <h3 className="text-xs font-bold uppercase tracking-widest text-chatroom-text-muted mb-3">
        Workspace Folder
      </h3>
      <div className="flex flex-col gap-3">
        <div className="flex items-center gap-2">
          <input
            type="text"
            value={selectedPath}
            onChange={(e) => onPathChange(e.target.value)}
            placeholder={placeholder}
            disabled={disabled || isPending}
            className="flex-1 bg-chatroom-bg-tertiary border border-chatroom-border text-sm font-mono text-chatroom-text-primary px-3 py-2 focus:outline-none focus:border-chatroom-accent disabled:opacity-50"
          />
          <button
            type="button"
            onClick={onBrowse}
            disabled={disabled || isPending || isConfirming}
            className="flex items-center gap-2 px-3 py-2 border border-chatroom-border text-xs font-bold uppercase tracking-wider text-chatroom-text-primary hover:bg-chatroom-bg-hover disabled:opacity-50"
          >
            {isPending ? <Loader2 size={14} className="animate-spin" /> : <FolderOpen size={14} />}
            Browse
          </button>
        </div>
        {requestId && isPending && (
          <p className="text-xs text-chatroom-text-muted">
            Waiting for folder selection on {machineDisplayName ?? 'machine'}...
          </p>
        )}
        {isTimedOut && (
          <button
            type="button"
            onClick={onRetryAfterTimeout}
            className="text-xs text-chatroom-accent hover:text-chatroom-text-primary text-left"
          >
            Folder picker timed out — click to try again
          </button>
        )}
      </div>
    </div>
  );
});
