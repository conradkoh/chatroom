'use client';

import React, { memo, useMemo } from 'react';

interface Participant {
  _id?: string;
  role: string;
  status: string;
}

interface WorkingIndicatorProps {
  participants: Participant[];
  /** Compact mode for bottom bar integration */
  compact?: boolean;
}

export const WorkingIndicator = memo(function WorkingIndicator({
  participants,
  compact = false,
}: WorkingIndicatorProps) {
  // Find active participants (excluding user) - memoized
  const activeAgents = useMemo(
    () => participants.filter((p) => p.status === 'active' && p.role.toLowerCase() !== 'user'),
    [participants]
  );

  if (activeAgents.length === 0) {
    return null;
  }

  // Compact mode: inline in bottom bar
  if (compact) {
    return (
      <div className="flex items-center gap-2">
        {activeAgents.map((agent, index) => (
          <div key={agent._id || agent.role} className="flex items-center gap-1.5">
            {index > 0 && <span className="text-chatroom-text-muted">·</span>}
            {/* Pulsing dot - modern animation */}
            <span className="w-1 h-1 bg-chatroom-status-info animate-pulse" />
            <span className="text-[10px] font-bold uppercase tracking-wide text-chatroom-status-info">
              {agent.role}
            </span>
          </div>
        ))}
      </div>
    );
  }

  // Default mode: standalone block (legacy)
  return (
    <div className="px-4 py-3 flex flex-col gap-2">
      {activeAgents.map((agent) => (
        <div
          key={agent._id || agent.role}
          className="flex items-center gap-3 px-4 py-3 bg-chatroom-status-info/10 border border-chatroom-status-info/20"
        >
          {/* Pulsing dots - modern animation */}
          <div className="flex gap-0.5 items-center">
            <span className="w-1 h-1 bg-chatroom-status-info animate-pulse" />
            <span className="w-1 h-1 bg-chatroom-status-info animate-pulse [animation-delay:150ms]" />
            <span className="w-1 h-1 bg-chatroom-status-info animate-pulse [animation-delay:300ms]" />
          </div>
          <div className="flex items-baseline gap-1.5">
            <span className="text-xs font-bold uppercase tracking-wide text-chatroom-status-info">
              {agent.role}
            </span>
            <span className="text-[10px] font-bold uppercase tracking-wide text-chatroom-text-muted">
              is working...
            </span>
          </div>
        </div>
      ))}
    </div>
  );
});
