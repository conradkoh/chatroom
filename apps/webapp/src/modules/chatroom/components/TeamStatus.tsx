'use client';

import { CheckCircle, Clock, AlertTriangle, RefreshCw } from 'lucide-react';
import React, { memo } from 'react';

interface ParticipantInfo {
  role: string;
  status: string;
  readyUntil?: number;
  isExpired: boolean;
}

interface TeamReadiness {
  isReady: boolean;
  expectedRoles: string[];
  missingRoles: string[];
  expiredRoles?: string[];
  participants?: ParticipantInfo[];
}

interface TeamStatusProps {
  readiness: TeamReadiness | null | undefined;
  onReconnect?: () => void;
}

export const TeamStatus = memo(function TeamStatus({ readiness, onReconnect }: TeamStatusProps) {
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

  // Check if there are expired roles (team was ready but now agents have disconnected)
  const hasExpiredRoles = readiness.expiredRoles && readiness.expiredRoles.length > 0;
  const isDisconnected = !readiness.isReady && hasExpiredRoles;

  return (
    <div className="p-4 border-b-2 border-chatroom-border-strong">
      <div className="text-[10px] font-bold uppercase tracking-widest text-chatroom-text-muted mb-3">
        Team Status
      </div>
      <div className="bg-chatroom-bg-tertiary p-4 flex flex-col items-center gap-2">
        {/* Status Icon */}
        <div
          className={`${
            readiness.isReady
              ? 'text-chatroom-status-success'
              : isDisconnected
                ? 'text-chatroom-status-error'
                : 'text-chatroom-status-warning'
          }`}
        >
          {readiness.isReady ? (
            <CheckCircle size={20} />
          ) : isDisconnected ? (
            <AlertTriangle size={20} />
          ) : (
            <Clock size={20} />
          )}
        </div>
        {/* Status Text */}
        <div
          className={`text-xs font-bold uppercase tracking-wide ${
            readiness.isReady
              ? 'text-chatroom-status-success'
              : isDisconnected
                ? 'text-chatroom-status-error'
                : 'text-chatroom-status-warning'
          }`}
        >
          {readiness.isReady
            ? 'Team Ready'
            : isDisconnected
              ? 'Agents Disconnected'
              : 'Waiting for members'}
        </div>
        {/* Status Detail */}
        <div className="text-[10px] text-chatroom-text-muted text-center">
          {readiness.isReady
            ? `All ${readiness.expectedRoles.length} members present`
            : isDisconnected
              ? `Disconnected: ${readiness.expiredRoles?.join(', ')}`
              : `Missing: ${readiness.missingRoles.join(', ')}`}
        </div>
        {/* Reconnect Button - shown when agents are disconnected */}
        {isDisconnected && onReconnect && (
          <button
            onClick={onReconnect}
            className="mt-2 flex items-center gap-2 px-3 py-1.5 bg-chatroom-bg-primary border-2 border-chatroom-status-info text-chatroom-status-info text-[10px] font-bold uppercase tracking-wide hover:bg-chatroom-status-info/10 transition-all duration-100"
          >
            <RefreshCw size={12} />
            Reconnect
          </button>
        )}
      </div>
    </div>
  );
});
