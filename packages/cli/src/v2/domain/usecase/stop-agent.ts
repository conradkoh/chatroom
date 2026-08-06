import type { CommandResult } from '../entities/machine-command.js';

export interface StopAgentInput {
  chatroomId: string;
  role: string;
  reason: string;
  deadline: number;
  pid?: number;
}

export interface StopAgentProcessManagerPort {
  stop(args: {
    chatroomId: string;
    role: string;
    reason: string;
    pid?: number;
  }): Promise<{ success: boolean }>;
}

export interface StopAgentDeps {
  agentProcessManager: StopAgentProcessManagerPort;
  now?: () => number;
  log?: (message: string) => void;
}

export async function stopAgent(
  deps: StopAgentDeps,
  input: StopAgentInput
): Promise<CommandResult> {
  const now = deps.now?.() ?? Date.now();
  const log = deps.log ?? console.log;
  if (now > input.deadline) {
    log(`[daemon] ⏰ Skipping expired agent.requestStop for role=${input.role} (deadline passed)`);
    return { result: 'Skipped expired stop', failed: false };
  }
  log(`   ↪ stop-agent command received`);
  log(`      Chatroom: ${input.chatroomId}`);
  log(`      Role: ${input.role}`);
  log(`      Reason: ${input.reason}`);

  const result = await deps.agentProcessManager.stop({
    chatroomId: input.chatroomId,
    role: input.role,
    reason: input.reason,
    pid: input.pid,
  });

  const msg = result.success
    ? `Agent stopped (${input.role})`
    : `Failed to stop agent (${input.role})`;
  log(`   ${result.success ? '✅' : '⚠️ '} ${msg}`);

  return { result: msg, failed: !result.success };
}
