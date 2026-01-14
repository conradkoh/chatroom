'use client';

import { CheckCircle, Clock } from 'lucide-react';
import React, { memo } from 'react';

interface TeamReadiness {
  isReady: boolean;
  expectedRoles: string[];
  missingRoles: string[];
}

interface TeamStatusProps {
  readiness: TeamReadiness | null | undefined;
}

export const TeamStatus = memo(function TeamStatus({ readiness }: TeamStatusProps) {
  if (readiness === undefined) {
    return (
      <div className="team-status">
        <div className="team-status-card">
          <div className="loading-spinner" style={{ margin: '0 auto' }} />
        </div>
      </div>
    );
  }

  // Legacy chatroom without team
  if (readiness === null) {
    return null;
  }

  return (
    <div className="team-status">
      <div className="panel-title">Team Status</div>
      <div className="team-status-card">
        <div className="team-status-icon">
          {readiness.isReady ? <CheckCircle size={20} /> : <Clock size={20} />}
        </div>
        <div className={`team-status-text ${readiness.isReady ? 'ready' : 'waiting'}`}>
          {readiness.isReady ? 'Team Ready' : 'Waiting for members'}
        </div>
        <div className="team-status-detail">
          {readiness.isReady
            ? `All ${readiness.expectedRoles.length} members present`
            : `Missing: ${readiness.missingRoles.join(', ')}`}
        </div>
      </div>
    </div>
  );
});
