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
    <div className="working-indicator-container">
      {activeAgents.map((agent) => (
        <div key={agent._id || agent.role} className="working-message">
          <div className="working-dots">
            <span className="dot" />
            <span className="dot" />
            <span className="dot" />
          </div>
          <div className="working-text">
            <span className="working-role">{agent.role}</span>
            <span className="working-label">is working...</span>
          </div>
        </div>
      ))}
    </div>
  );
});
