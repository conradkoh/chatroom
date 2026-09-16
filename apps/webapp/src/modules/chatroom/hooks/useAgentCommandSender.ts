'use client';

import { api } from '@workspace/backend/convex/_generated/api';
import { useSessionMutation } from 'convex-helpers/react/sessions';
import { useCallback } from 'react';

import type { SendCommandFn } from '../types/machine';
import { dispatchAgentCommand } from '../utils/agentCommand';

/** Composes start / restart / send command mutations into one dispatcher. */
export function useAgentCommandSender(): SendCommandFn {
  const requestStart = useSessionMutation(api.agents.requestStart);
  const requestRestart = useSessionMutation(api.agents.requestRestart);
  const sendCommand = useSessionMutation(api.machines.sendCommand);

  return useCallback<SendCommandFn>(
    (command) =>
      dispatchAgentCommand(command, {
        requestStart,
        requestRestart,
        sendCommand: sendCommand as unknown as SendCommandFn,
      }),
    [requestRestart, requestStart, sendCommand]
  );
}
