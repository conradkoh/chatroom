import type { Id } from '@workspace/backend/convex/_generated/dataModel';

import type { AgentHarness, SendCommandArgs, SendCommandFn } from '../types/machine';

/** Canonical input for all client-side start-agent dispatches. */
export interface StartAgentInput {
  machineId: string;
  chatroomId: Id<'chatroom_rooms'>;
  role: string;
  agentHarness: AgentHarness;
  model?: string;
  workingDir?: string;
  wantResume?: boolean;
  allowNewMachine?: boolean;
}

// fallow-ignore-next-line complexity
function buildStartAgentCommand(
  input: StartAgentInput
): Extract<SendCommandArgs, { type: 'start-agent' }> {
  const trimmedWorkingDir = input.workingDir?.trim();
  return {
    machineId: input.machineId,
    type: 'start-agent',
    payload: {
      chatroomId: input.chatroomId,
      role: input.role,
      agentHarness: input.agentHarness,
      ...(input.model ? { model: input.model } : {}),
      ...(trimmedWorkingDir ? { workingDir: trimmedWorkingDir } : {}),
      ...(input.wantResume !== undefined ? { wantResume: input.wantResume } : {}),
      ...(input.allowNewMachine ? { allowNewMachine: true as const } : {}),
    },
  };
}

export async function dispatchStartAgent(
  sendCommand: SendCommandFn,
  input: StartAgentInput
): Promise<unknown> {
  return sendCommand(buildStartAgentCommand(input));
}

export async function startAgentsBatch(
  roles: string[],
  getInputForRole: (role: string) => StartAgentInput | null,
  sendCommand: SendCommandFn
): Promise<PromiseSettledResult<unknown>[]> {
  return Promise.allSettled(
    roles.map((role) => {
      const input = getInputForRole(role);
      if (!input) return Promise.resolve(null);
      return dispatchStartAgent(sendCommand, input);
    })
  );
}
