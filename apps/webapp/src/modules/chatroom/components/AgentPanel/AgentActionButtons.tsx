'use client';

import React, { useCallback, useState } from 'react';
import { StopCircle, Zap } from 'lucide-react';
import type { Id } from '@workspace/backend/convex/_generated/dataModel';
import { getHarnessCapabilities } from '../../types/machine';
import type { MachineInfo, SendCommandFn } from '../../types/machine';

export interface AgentActionButtonsProps {
  role: string;
  chatroomId: string;
  machine: MachineInfo | undefined;
  agentHarness: string | undefined;
  online: boolean;
  sendCommand: SendCommandFn;
}

/** Abort and Compact action buttons for an agent, gated by capabilities. */
export const AgentActionButtons = React.memo(function AgentActionButtons({
  role,
  chatroomId,
  machine,
  agentHarness,
  online,
  sendCommand,
}: AgentActionButtonsProps) {
  const [isLoading, setIsLoading] = useState(false);

  // Get capabilities for this harness
  const capabilities = machine && agentHarness ? getHarnessCapabilities(machine, agentHarness as any) : undefined;

  const canAbort = capabilities?.abort ?? false;
  const canCompact = capabilities?.compaction ?? false;

  const handleAbort = useCallback(async () => {
    if (!machine || !online) return;
    setIsLoading(true);
    try {
      await sendCommand({
        machineId: machine.machineId,
        type: 'abort-agent',
        payload: {
          chatroomId: chatroomId as Id<'chatroom_rooms'>,
          role,
        },
      });
    } finally {
      setIsLoading(false);
    }
  }, [chatroomId, machine, online, role, sendCommand]);

  const handleCompact = useCallback(async () => {
    if (!machine || !online) return;
    setIsLoading(true);
    try {
      await sendCommand({
        machineId: machine.machineId,
        type: 'compact-agent',
        payload: {
          chatroomId: chatroomId as Id<'chatroom_rooms'>,
          role,
        },
      });
    } finally {
      setIsLoading(false);
    }
  }, [chatroomId, machine, online, role, sendCommand]);

  // Hidden if neither capability is enabled
  if (!canAbort && !canCompact) {
    return null;
  }

  return (
    <div className="flex gap-1">
      {canAbort && (
        <button
          type="button"
          onClick={handleAbort}
          disabled={!online || isLoading}
          className="p-1 text-chatroom-text-muted hover:text-chatroom-accent disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          title={!online ? 'Agent is offline' : 'Abort session'}
          aria-label={`Abort agent session for ${role}`}
        >
          <StopCircle size={14} />
        </button>
      )}
      {canCompact && (
        <button
          type="button"
          onClick={handleCompact}
          disabled={!online || isLoading}
          className="p-1 text-chatroom-text-muted hover:text-chatroom-accent disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          title={!online ? 'Agent is offline' : 'Compact session'}
          aria-label={`Compact agent session for ${role}`}
        >
          <Zap size={14} />
        </button>
      )}
    </div>
  );
});
