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
      <div className="p-4 border-b-2 border-chatroom-border-strong">
        <div className="bg-chatroom-bg-tertiary p-4 flex flex-col items-center justify-center">
          <div className="w-5 h-5 border-2 border-chatroom-border border-t-chatroom-accent animate-spin" />
        </div>
      </div>
    );
  }

  // Legacy chatroom without team
  if (readiness === null) {
    return null;
  }

  return (
    <div className="p-4 border-b-2 border-chatroom-border-strong">
      <div className="text-[10px] font-bold uppercase tracking-widest text-chatroom-text-muted mb-3">
        Team Status
      </div>
      <div className="bg-chatroom-bg-tertiary p-4 flex flex-col items-center gap-2">
        {/* Status Icon */}
        <div
          className={`${readiness.isReady ? 'text-chatroom-status-success' : 'text-chatroom-status-warning'}`}
        >
          {readiness.isReady ? <CheckCircle size={20} /> : <Clock size={20} />}
        </div>
        {/* Status Text */}
        <div
          className={`text-xs font-bold uppercase tracking-wide ${readiness.isReady ? 'text-chatroom-status-success' : 'text-chatroom-status-warning'}`}
        >
          {readiness.isReady ? 'Team Ready' : 'Waiting for members'}
        </div>
        {/* Status Detail */}
        <div className="text-[10px] text-chatroom-text-muted text-center">
          {readiness.isReady
            ? `All ${readiness.expectedRoles.length} members present`
            : `Missing: ${readiness.missingRoles.join(', ')}`}
        </div>
      </div>
    </div>
  );
});
