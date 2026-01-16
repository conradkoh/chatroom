'use client';

import React, { memo, useMemo } from 'react';

interface Participant {
  _id?: string;
  role: string;
  status: string;
}

interface WorkingIndicatorProps {
  participants: Participant[];
}

export const WorkingIndicator = memo(function WorkingIndicator({
  participants,
}: WorkingIndicatorProps) {
  // Find active participants (excluding user) - memoized
  const activeAgents = useMemo(
    () => participants.filter((p) => p.status === 'active' && p.role.toLowerCase() !== 'user'),
    [participants]
  );

  if (activeAgents.length === 0) {
    return null;
  }

  return (
    <div className="px-4 py-3 flex flex-col gap-2">
      {activeAgents.map((agent) => (
        <div
          key={agent._id || agent.role}
          className="flex items-center gap-3 px-4 py-3 bg-chatroom-status-info/10 border border-chatroom-status-info/20"
        >
          {/* Bouncing dots */}
          <div className="flex gap-1 items-center">
            <span className="w-1.5 h-1.5 bg-chatroom-status-info animate-bounce [animation-delay:0ms]" />
            <span className="w-1.5 h-1.5 bg-chatroom-status-info animate-bounce [animation-delay:200ms]" />
            <span className="w-1.5 h-1.5 bg-chatroom-status-info animate-bounce [animation-delay:400ms]" />
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
