import type { AgentHarness } from '../entities/harness-shared-types.js';

export interface StartAgentInput {
  commandId: string;
  chatroomId: string;
  role: string;
  agentHarness: AgentHarness;
  model: string;
  workingDir: string;
  reason: string;
  deadline: number;
  wantResume: boolean;
}

export interface AgentProcessManagerPort {
  startAgent(args: {
    chatroomId: string;
    role: string;
    agentHarness: AgentHarness;
    model: string;
    workingDir: string;
    reason: string;
    wantResume: boolean;
  }): Promise<void>;
}

export interface StartAgentSessionPort {
  sessionId: string;
  machineId: string;
  hostname: string;
  emitAgentStartFailed(args: { chatroomId: string; role: string; error: string }): Promise<void>;
  registerWorkspace(args: {
    chatroomId: string;
    workingDir: string;
    registeredBy: string;
  }): Promise<void>;
}

export interface StartAgentDeps {
  agentProcessManager: AgentProcessManagerPort;
  session: StartAgentSessionPort;
  now?: (() => number) | undefined;
  log?: ((message: string) => void) | undefined;
}

export async function startAgent(deps: StartAgentDeps, input: StartAgentInput): Promise<void> {
  const now = deps.now?.() ?? Date.now();
  const log = deps.log ?? console.log;
  if (now > input.deadline) {
    log(
      `[daemon] ⏰ Skipping expired agent.requestStart for role=${input.role} (id: ${input.commandId}, deadline passed)`
    );
    return;
  }
  log(`[daemon] Processing agent.requestStart (id: ${input.commandId})`);
  try {
    await deps.agentProcessManager.startAgent({
      chatroomId: input.chatroomId,
      role: input.role,
      agentHarness: input.agentHarness,
      model: input.model,
      workingDir: input.workingDir,
      reason: input.reason,
      wantResume: input.wantResume,
    });
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : typeof error === 'object' && error !== null && 'error' in error
          ? String(error.error)
          : 'unknown';
    log(`[daemon] Agent start rejected for role=${input.role}: ${message}`);
    await deps.session.emitAgentStartFailed({
      chatroomId: input.chatroomId,
      role: input.role,
      error: message,
    });
    return;
  }
  await deps.session.registerWorkspace({
    chatroomId: input.chatroomId,
    workingDir: input.workingDir,
    registeredBy: input.role,
  });
}
