export interface RestartAgentInput {
  commandId: string;
  chatroomId: string;
  machineId: string;
  role: string;
  agentHarness: string;
  model: string;
  workingDir: string;
  correlationId: string;
  deadline: number;
  wantResume: boolean;
  lifecycleRevision?: number | undefined;
}

export interface RestartOrchestratorPort {
  runRestart(input: Omit<RestartAgentInput, 'commandId' | 'deadline'>): Promise<void>;
}

export interface RestartAgentDeps {
  restartOrchestrator: RestartOrchestratorPort;
  now?:( () => number) | undefined;
  log?:( (message: string) => void) | undefined;
}

export async function restartAgent(
  deps: RestartAgentDeps,
  input: RestartAgentInput
): Promise<void> {
  const now = deps.now?.() ?? Date.now();
  const log = deps.log ?? console.log;
  if (now > input.deadline) {
    log(`[daemon] ⏰ Skipping expired agent.restart for role=${input.role} (deadline passed)`);
    return;
  }
  log(
    `[daemon] Processing agent.restart (correlationId=${input.correlationId}) for role=${input.role}`
  );
  try {
    await deps.restartOrchestrator.runRestart({
      chatroomId: input.chatroomId,
      machineId: input.machineId,
      role: input.role,
      agentHarness: input.agentHarness,
      model: input.model,
      workingDir: input.workingDir,
      correlationId: input.correlationId,
      wantResume: input.wantResume,
      ...(input.lifecycleRevision !== undefined
        ? { lifecycleRevision: input.lifecycleRevision }
        : {}),
    });
  } catch {
    // Swallow errors like legacy Effect.catchAll
  }
}
