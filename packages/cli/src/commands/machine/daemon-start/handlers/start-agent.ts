/**
 * Start Agent Command Handler — spawns an agent process for a chatroom role.
 */

import { api } from '../../../../api.js';
import { getConvexUrl } from '../../../../infrastructure/convex/client.js';
import type { CommandResult, DaemonContext, StartAgentCommand } from '../types.js';
import { formatTimestamp } from '../utils.js';
import { handleAgentCrashRecovery } from './crash-recovery.js';

/**
 * Handle a start-agent command — spawns an agent process for a chatroom role.
 */
export async function handleStartAgent(
  ctx: DaemonContext,
  command: StartAgentCommand
): Promise<CommandResult> {
  const { chatroomId, role, agentHarness, model, workingDir } = command.payload;
  console.log(`   ↪ start-agent command received`);
  console.log(`      Chatroom: ${chatroomId}`);
  console.log(`      Role: ${role}`);
  console.log(`      Harness: ${agentHarness}`);
  if (model) {
    console.log(`      Model: ${model}`);
  }

  // Get agent context for working directory.
  // First try local config, then fall back to workingDir from the command payload
  // (which the backend resolves from chatroom_machineAgentConfigs).
  let agentContext = ctx.deps.machine.getAgentContext(chatroomId, role);

  if (!agentContext && workingDir) {
    // No local context — use the working directory from the command payload
    // and update the local config so future commands don't need this fallback
    console.log(`   No local agent context, using workingDir from command payload`);
    ctx.deps.machine.updateAgentContext(chatroomId, role, agentHarness, workingDir);
    agentContext = ctx.deps.machine.getAgentContext(chatroomId, role);
  }

  if (!agentContext) {
    const msg = `No agent context found for ${chatroomId}/${role}`;
    console.log(`   ⚠️  ${msg}`);
    return { result: msg, failed: true };
  }

  console.log(`      Working dir: ${agentContext.workingDir}`);

  // SECURITY: Validate working directory exists on the local filesystem
  // using fs.stat (not a shell command) to prevent path-based attacks.
  // This is defense-in-depth alongside the backend's character validation.
  try {
    const dirStat = await ctx.deps.fs.stat(agentContext.workingDir);
    if (!dirStat.isDirectory()) {
      const msg = `Working directory is not a directory: ${agentContext.workingDir}`;
      console.log(`   ⚠️  ${msg}`);
      return { result: msg, failed: true };
    }
  } catch {
    const msg = `Working directory does not exist: ${agentContext.workingDir}`;
    console.log(`   ⚠️  ${msg}`);
    return { result: msg, failed: true };
  }

  // Fetch split init prompt from backend (single source of truth)
  const convexUrl = getConvexUrl();
  const initPromptResult = await ctx.deps.backend.query(api.messages.getInitPrompt, {
    sessionId: ctx.sessionId,
    chatroomId,
    role,
    convexUrl,
  });

  if (!initPromptResult?.prompt) {
    const msg = 'Failed to fetch init prompt from backend';
    console.log(`   ⚠️  ${msg}`);
    return { result: msg, failed: true };
  }

  console.log(`   Fetched split init prompt from backend`);

  // Get harness version for version-specific spawn logic (uses cached config)
  const harnessVersion = ctx.config?.harnessVersions?.[agentHarness];

  // Resolve driver from registry and start the agent
  let driver;
  try {
    driver = ctx.deps.drivers.get(agentHarness);
  } catch {
    const msg = `No driver registered for harness: ${agentHarness}`;
    console.log(`   ⚠️  ${msg}`);
    return { result: msg, failed: true };
  }

  const startResult = await driver.start({
    workingDir: agentContext.workingDir,
    rolePrompt: initPromptResult.rolePrompt,
    initialMessage: initPromptResult.initialMessage,
    harnessVersion: harnessVersion ?? undefined,
    model,
  });

  if (startResult.success && startResult.handle) {
    const msg = `Agent spawned (PID: ${startResult.handle.pid})`;
    console.log(`   ✅ ${msg}`);

    // Update backend with spawned agent PID and persist locally
    if (startResult.handle.pid) {
      try {
        await ctx.deps.backend.mutation(api.machines.updateSpawnedAgent, {
          sessionId: ctx.sessionId,
          machineId: ctx.machineId,
          chatroomId,
          role,
          pid: startResult.handle.pid,
          model,
        });
        console.log(`   Updated backend with PID: ${startResult.handle.pid}`);

        // Persist PID locally for daemon restart recovery
        ctx.deps.machine.persistAgentPid(
          ctx.machineId,
          chatroomId,
          role,
          startResult.handle.pid,
          agentHarness
        );
      } catch (e) {
        console.log(`   ⚠️  Failed to update PID in backend: ${(e as Error).message}`);
      }

      // Monitor for process exit.
      // On exit, check whether this was an intentional stop (from handleStopAgent)
      // or an unexpected crash. Only run crash recovery for unexpected exits.
      if (startResult.onExit) {
        const spawnedPid = startResult.handle.pid;
        startResult.onExit((code: number | null, signal: string | null) => {
          const ts = formatTimestamp();

          if (ctx.deps.stops.consume(chatroomId, role)) {
            // Intentional stop — skip crash recovery
            console.log(
              `[${ts}] ℹ️  Agent process exited after intentional stop ` +
                `(PID: ${spawnedPid}, role: ${role}, code: ${code}, signal: ${signal})`
            );
            return;
          }

          console.log(
            `[${ts}] ⚠️  Agent process exited unexpectedly ` +
              `(PID: ${spawnedPid}, role: ${role}, code: ${code}, signal: ${signal})`
          );
          // Run crash recovery asynchronously
          handleAgentCrashRecovery(ctx, command).catch((err) => {
            console.log(`   ⚠️  Crash recovery failed for ${role}: ${(err as Error).message}`);
          });
        });
      }
    }
    return { result: msg, failed: false };
  }

  console.log(`   ⚠️  ${startResult.message}`);
  return { result: startResult.message, failed: true };
}
