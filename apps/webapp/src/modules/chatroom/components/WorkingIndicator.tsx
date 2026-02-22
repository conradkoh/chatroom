'use client';

import React, { memo, useMemo } from 'react';

interface WorkingAgent {
  role: string;
}

interface WorkingIndicatorProps {
  readiness?: { participants?: { role: string; lastSeenAction?: string | null }[] } | null;
  /** Compact mode for bottom bar integration */
  compact?: boolean;
}

export const WorkingIndicator = memo(function WorkingIndicator({
  readiness,
  compact = false,
}: WorkingIndicatorProps) {
  const workingAgents: WorkingAgent[] = useMemo(() => {
    if (!readiness?.participants) return [];
    return readiness.participants.filter(
      (p) => p.lastSeenAction === 'task-started' && p.role.toLowerCase() !== 'user'
    );
  }, [readiness?.participants]);

  const shouldShowInStatusBar = workingAgents.length > 0;

  if (!shouldShowInStatusBar) {
    return null;
  }

  // Compact mode: inline in bottom bar
  if (compact) {
    return (
      <div className="flex items-center gap-2">
        {workingAgents.map((agent, index) => (
          <div key={agent.role} className="flex items-center gap-1.5">
            {index > 0 && <span className="text-chatroom-text-muted">·</span>}
            {/* Pulsing indicator - square per theme */}
            <span className="w-2 h-2 bg-chatroom-status-info animate-pulse" />
            <span className="text-[10px] font-bold uppercase tracking-wider text-chatroom-status-info">
              {agent.role}
            </span>
            <span className="text-[10px] font-bold uppercase tracking-wider text-chatroom-text-muted">
              WORKING
            </span>
          </div>
        ))}
      </div>
    );
  }

  // Default mode: standalone block (legacy)
  return (
    <div className="px-4 py-3 flex flex-col gap-2">
      {workingAgents.map((agent) => (
        <div
          key={agent.role}
          className="flex items-center gap-3 px-4 py-3 bg-chatroom-status-info/10 border-2 border-chatroom-status-info/20"
        >
          {/* Pulsing squares - per theme guidelines */}
          <div className="flex gap-1 items-center">
            <span className="w-2 h-2 bg-chatroom-status-info animate-pulse" />
            <span className="w-2 h-2 bg-chatroom-status-info animate-pulse [animation-delay:150ms]" />
            <span className="w-2 h-2 bg-chatroom-status-info animate-pulse [animation-delay:300ms]" />
          </div>
          <div className="flex items-baseline gap-1.5">
            <span className="text-xs font-bold uppercase tracking-wider text-chatroom-status-info">
              {agent.role}
            </span>
            <span className="text-[10px] font-bold uppercase tracking-wider text-chatroom-text-muted">
              WORKING
            </span>
          </div>
        </div>
      ))}
    </div>
  );
});
