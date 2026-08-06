export interface ActiveAgentSlot {
  chatroomId: string;
  role: string;
}

export interface RecoverAgentProcessManagerPort {
  recover(): Promise<void>;
  listActive(): ActiveAgentSlot[];
}

export interface RecoverAgentBackendPort {
  getMachineAgentConfigs(chatroomId: string): Promise<{
    configs: { machineId: string; workingDir?: string; role: string }[];
  }>;
  registerWorkspace(args: {
    chatroomId: string;
    workingDir: string;
    registeredBy: string;
  }): Promise<void>;
  getMachineHarnessSessions(): Promise<{ chatroomId: string; harnessSessionId: string }[]>;
  markOrphanTurnsFailed(harnessSessionId: string): Promise<{ failedTurns: number }>;
}

export interface RecoverAgentSessionPort {
  sessionId: string;
  machineId: string;
  hostname: string;
}

export interface RecoverAgentStateDeps {
  agentProcessManager: RecoverAgentProcessManagerPort;
  backend: RecoverAgentBackendPort;
  session: RecoverAgentSessionPort;
  log?: (message: string) => void;
  warn?: (message: string) => void;
}

export async function recoverAgentState(deps: RecoverAgentStateDeps): Promise<void> {
  const log = deps.log ?? console.log;
  const warn = deps.warn ?? console.warn;

  await deps.agentProcessManager.recover();

  const activeSlots = deps.agentProcessManager.listActive();

  if (activeSlots.length === 0) {
    log(`   No active agents after recovery`);
  } else {
    const chatroomIds = new Set(activeSlots.map((s) => s.chatroomId));
    let registeredCount = 0;

    for (const chatroomId of chatroomIds) {
      try {
        const configsResult = await deps.backend.getMachineAgentConfigs(chatroomId);
        for (const config of configsResult.configs) {
          if (config.machineId === deps.session.machineId && config.workingDir) {
            registeredCount++;
            void deps.backend
              .registerWorkspace({
                chatroomId,
                workingDir: config.workingDir,
                registeredBy: config.role,
              })
              .catch((err: Error) => {
                warn(`[daemon] ⚠️ Failed to register workspace on recovery: ${err.message}`);
              });
          }
        }
      } catch {
        // Per-chatroom errors are non-fatal (legacy Effect.catchAll)
      }
    }

    if (registeredCount > 0) {
      log(`   🔀 Registered ${registeredCount} workspace(s) on recovery`);
    }
  }

  try {
    const managedSessions = await deps.backend.getMachineHarnessSessions();

    let orphanSessionCount = 0;
    let totalFailedTurns = 0;

    for (const hs of managedSessions) {
      const hasActiveSlot = activeSlots.some((s) => s.chatroomId === hs.chatroomId);
      if (hasActiveSlot) continue;

      try {
        const result = await deps.backend.markOrphanTurnsFailed(hs.harnessSessionId);
        orphanSessionCount++;
        totalFailedTurns += result.failedTurns;
      } catch (err) {
        warn(
          `[daemon] ⚠️ Failed to mark orphan turns for session ${hs.harnessSessionId}: ${(err as Error).message}`
        );
      }
    }

    if (orphanSessionCount > 0) {
      log(
        `   🧹 Marked ${totalFailedTurns} turns as failed across ${orphanSessionCount} orphan sessions`
      );
    }
  } catch (err) {
    warn(`[daemon] ⚠️ Orphan turn cleanup failed: ${(err as Error).message}`);
  }
}
