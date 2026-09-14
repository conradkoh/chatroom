import type { Id } from '@workspace/backend/convex/_generated/dataModel';

import type { AgentHarness, SendCommandArgs, SendCommandFn } from '../types/machine';

export interface RequestStartArgs {
  machineId: string;
  chatroomId: Id<'chatroom_rooms'>;
  workspaceId?: Id<'chatroom_workspaces'>;
  role: string;
  agentHarness: AgentHarness;
  model?: string;
  workingDir?: string;
  allowNewMachine?: boolean;
  wantResume?: boolean;
}

export interface RequestRestartArgs {
  machineId: string;
  chatroomId: Id<'chatroom_rooms'>;
  workspaceId?: Id<'chatroom_workspaces'>;
  role: string;
  agentHarness: AgentHarness;
  model: string;
  workingDir: string;
}

interface AgentCommandMutations {
  requestStart: (args: RequestStartArgs) => Promise<unknown>;
  requestRestart: (args: RequestRestartArgs) => Promise<unknown>;
  sendCommand: SendCommandFn;
}

/** Routes the two canonical agent lifecycle commands through their mutations. */
export function dispatchAgentCommand(
  command: SendCommandArgs,
  mutations: AgentCommandMutations
): Promise<unknown> {
  if (!('type' in command)) return mutations.sendCommand(command);

  if (command.type === 'start-agent') {
    return mutations.requestStart({
      machineId: command.machineId,
      chatroomId: command.payload.chatroomId,
      ...(command.payload.workspaceId !== undefined
        ? { workspaceId: command.payload.workspaceId }
        : {}),
      role: command.payload.role,
      agentHarness: command.payload.agentHarness,
      ...(command.payload.model !== undefined ? { model: command.payload.model } : {}),
      ...(command.payload.workingDir !== undefined
        ? { workingDir: command.payload.workingDir }
        : {}),
      ...(command.payload.allowNewMachine !== undefined
        ? { allowNewMachine: command.payload.allowNewMachine }
        : {}),
      ...(command.payload.wantResume !== undefined
        ? { wantResume: command.payload.wantResume }
        : {}),
    });
  }

  if (command.type === 'restart-agent') {
    return mutations.requestRestart({
      machineId: command.machineId,
      chatroomId: command.payload.chatroomId,
      ...(command.payload.workspaceId !== undefined
        ? { workspaceId: command.payload.workspaceId }
        : {}),
      role: command.payload.role,
      agentHarness: command.payload.agentHarness,
      model: command.payload.model,
      workingDir: command.payload.workingDir,
    });
  }

  return mutations.sendCommand(command);
}
