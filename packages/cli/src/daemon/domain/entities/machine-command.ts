import type { AgentHarness } from './harness-shared-types.js';

export type StartAgentReason = string;
export type StopAgentReason = string;

export interface StartAgentCommand {
  type: 'start-agent';
  reason: StartAgentReason;
  payload: {
    chatroomId: string;
    role: string;
    agentHarness: AgentHarness;
    model?: string | undefined;
    workingDir?: string | undefined;
  };
}

export interface StopAgentCommand {
  type: 'stop-agent';
  reason: StopAgentReason;
  payload: {
    chatroomId: string;
    role: string;
  };
}

export type MachineCommand = StartAgentCommand | StopAgentCommand;

export interface CommandResult {
  result: string;
  failed: boolean;
}

export function isStartAgentCommand(cmd: MachineCommand): cmd is StartAgentCommand {
  return cmd.type === 'start-agent';
}

export function isStopAgentCommand(cmd: MachineCommand): cmd is StopAgentCommand {
  return cmd.type === 'stop-agent';
}
