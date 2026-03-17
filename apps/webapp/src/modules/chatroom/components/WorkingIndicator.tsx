'use client';

import React, { memo } from 'react';

interface WorkingIndicatorProps {
  activeTask?: { status: string; assignedTo?: string } | null;
  /** Compact mode for bottom bar integration */
  compact?: boolean;
  /** Optional chatroom ID (for future use / event stream integration) */
  chatroomId?: string;
  /** Called when the user clicks the compact indicator */
  onOpenEventStream?: () => void;
}

export const WorkingIndicator = memo(function WorkingIndicator({
  activeTask,
  compact = false,
  onOpenEventStream,
}: WorkingIndicatorProps) {
  if (activeTask?.status !== 'in_progress') {
    return null;
  }

  const roleName = activeTask.assignedTo ?? 'Agent';

  // Compact mode: inline in bottom bar
  if (compact) {
    return (
      <button
        type="button"
        onClick={onOpenEventStream}
        className="flex items-center gap-2 cursor-pointer hover:bg-chatroom-bg-hover transition-colors rounded"
      >
        <div className="flex items-center gap-1.5">
          {/* Pulsing indicator - square per theme */}
          <span className="w-2 h-2 bg-chatroom-status-info animate-pulse" />
          <span className="text-[10px] font-bold uppercase tracking-wider text-chatroom-status-info">
            {roleName}
          </span>
          <span className="text-[10px] font-bold uppercase tracking-wider text-chatroom-text-muted">
            WORKING
          </span>
        </div>
      </button>
    );
  }

  // Default mode: standalone block (legacy)
  return (
    <div className="px-4 py-3 flex flex-col gap-2">
      <div className="flex items-center gap-3 px-4 py-3 bg-chatroom-status-info/10 border-2 border-chatroom-status-info/20">
        {/* Pulsing squares - per theme guidelines */}
        <div className="flex gap-1 items-center">
          <span className="w-2 h-2 bg-chatroom-status-info animate-pulse" />
          <span className="w-2 h-2 bg-chatroom-status-info animate-pulse [animation-delay:150ms]" />
          <span className="w-2 h-2 bg-chatroom-status-info animate-pulse [animation-delay:300ms]" />
        </div>
        <div className="flex items-baseline gap-1.5">
          <span className="text-xs font-bold uppercase tracking-wider text-chatroom-status-info">
            {roleName}
          </span>
          <span className="text-[10px] font-bold uppercase tracking-wider text-chatroom-text-muted">
            WORKING
          </span>
        </div>
      </div>
    </div>
  );
});
