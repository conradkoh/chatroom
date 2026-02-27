'use client';

import { CheckCircle, Clock, AlertTriangle, RefreshCw } from 'lucide-react';
import React, { memo } from 'react';

import type { TeamLifecycle } from '../types/readiness';

// PRESENCE_THRESHOLD_MS — agents unseen for longer are considered offline
const PRESENCE_THRESHOLD_MS = 600_000; // 10 minutes

interface TeamStatusProps {
  lifecycle: TeamLifecycle | null | undefined;
  onReconnect?: () => void;
}

/** @deprecated TeamStatus is consolidated into AgentPanel. This component is kept for API compatibility only. */
export const TeamStatus = memo(function TeamStatus({ lifecycle, onReconnect }: TeamStatusProps) {
  if (lifecycle === undefined) {
    return (
      <div className="p-4 border-b-2 border-chatroom-border-strong">
        <div className="bg-chatroom-bg-tertiary p-4 flex flex-col items-center justify-center">
          <div className="w-5 h-5 border-2 border-chatroom-border border-t-chatroom-accent animate-spin" />
        </div>
      </div>
    );
  }

  // Legacy chatroom without team
  if (lifecycle === null) {
    return null;
  }

  // Derive status from raw presence data
  const now = Date.now();
  const expiredRoles = lifecycle.expectedRoles.filter((role) => {
    const p = lifecycle.participants.find((p) => p.role.toLowerCase() === role.toLowerCase());
    return p?.lastSeenAt != null && now - p.lastSeenAt > PRESENCE_THRESHOLD_MS;
  });
  const missingRoles = lifecycle.expectedRoles.filter((role) => {
    const p = lifecycle.participants.find((p) => p.role.toLowerCase() === role.toLowerCase());
    return p?.lastSeenAt == null;
  });
  const isReady = expiredRoles.length === 0 && missingRoles.length === 0;
  const isDisconnected = !isReady && expiredRoles.length > 0;

  return (
    <div className="p-4 border-b-2 border-chatroom-border-strong">
      <div className="text-[10px] font-bold uppercase tracking-widest text-chatroom-text-muted mb-3">
        Team Status
      </div>
      <div className="bg-chatroom-bg-tertiary p-4 flex flex-col items-center gap-2">
        {/* Status Icon */}
        <div
          className={`${
            isReady
              ? 'text-chatroom-status-success'
              : isDisconnected
                ? 'text-chatroom-status-error'
                : 'text-chatroom-status-warning'
          }`}
        >
          {isReady ? (
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
            isReady
              ? 'text-chatroom-status-success'
              : isDisconnected
                ? 'text-chatroom-status-error'
                : 'text-chatroom-status-warning'
          }`}
        >
          {isReady
            ? 'Team Ready'
            : isDisconnected
              ? 'Agents Disconnected'
              : 'Waiting for members'}
        </div>
        {/* Status Detail */}
        <div className="text-[10px] text-chatroom-text-muted text-center">
          {isReady
            ? `All ${lifecycle.expectedRoles.length} members present`
            : isDisconnected
              ? `Disconnected: ${expiredRoles.join(', ')}`
              : `Missing: ${missingRoles.join(', ')}`}
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
