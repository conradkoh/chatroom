/**
 * Start Agent Command Handler — spawns an agent process for a chatroom role.
 */

import { api } from '../../../../api.js';
import { getConvexUrl } from '../../../../infrastructure/convex/client.js';
import type { CommandResult, DaemonContext, StartAgentCommand } from '../types.js';
import { formatTimestamp } from '../utils.js';
import { clearAgentPidEverywhere } from './shared.js';

/**
 * Handle a start-agent command — spawns an agent process for a chatroom role.
 *
 * The working directory MUST be provided in the command payload by the caller
 * (frontend / backend). The daemon never resolves or caches working directories locally.
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

  if (!workingDir) {
    const msg = `No workingDir provided in command payload for ${chatroomId}/${role}`;
    console.log(`   ⚠️  ${msg}`);
    return { result: msg, failed: true };
  }

  console.log(`      Working dir: ${workingDir}`);

  // Validate against desired state — discard stale start commands
  // that have been superseded by a newer stop request.
  try {
    const desiredState = await ctx.deps.backend.query(
      api.machineAgentDesiredState.getDesiredState,
      {
        sessionId: ctx.sessionId,
        chatroomId,
        role,
      }
    );

    if (desiredState && desiredState.desiredStatus !== 'running') {
      const msg =
        `Discarded stale start-agent command for ${role} — ` +
        `desired state is "${desiredState.desiredStatus}" ` +
        `(set by ${desiredState.requestedBy} at ${new Date(desiredState.requestedAt).toISOString()})`;
      console.log(`   ℹ️  ${msg}`);
      return { result: msg, failed: false };
    }
  } catch (e) {
    console.log(
      `   ⚠️  Failed to check desired state, proceeding with start: ${(e as Error).message}`
    );
  }

  // SECURITY: Validate working directory exists on the local filesystem
  // using fs.stat (not a shell command) to prevent path-based attacks.
  // This is defense-in-depth alongside the backend's character validation.
  try {
    const dirStat = await ctx.deps.fs.stat(workingDir);
    if (!dirStat.isDirectory()) {
      const msg = `Working directory is not a directory: ${workingDir}`;
      console.log(`   ⚠️  ${msg}`);
      return { result: msg, failed: true };
    }
  } catch {
    const msg = `Working directory does not exist: ${workingDir}`;
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
    workingDir,
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

      // Monitor for process exit — log and clean up state.
      // Agents are children of the daemon and are not auto-restarted.
      if (startResult.onExit) {
        const spawnedPid = startResult.handle.pid;
        startResult.onExit((code: number | null, signal: string | null) => {
          const ts = formatTimestamp();
          const wasIntentional = ctx.deps.stops.consume(chatroomId, role);

          if (wasIntentional) {
            console.log(
              `[${ts}] ℹ️  Agent process exited after intentional stop ` +
                `(PID: ${spawnedPid}, role: ${role}, code: ${code}, signal: ${signal})`
            );
          } else {
            console.log(
              `[${ts}] ⚠️  Agent process exited ` +
                `(PID: ${spawnedPid}, role: ${role}, code: ${code}, signal: ${signal})`
            );
          }

          // Clean up PID from backend and local state
          clearAgentPidEverywhere(ctx, chatroomId, role).catch((err) => {
            console.log(`   ⚠️  Failed to clear PID after exit: ${(err as Error).message}`);
          });

          // Mark agent as offline so the UI reflects the exit
          ctx.deps.backend
            .mutation(api.participants.leave, {
              sessionId: ctx.sessionId,
              chatroomId,
              role,
            })
            .catch((leaveErr: Error) => {
              console.log(`   ⚠️  Could not remove participant: ${leaveErr.message}`);
            });
        });
      }
    }
    return { result: msg, failed: false };
  }

  console.log(`   ⚠️  ${startResult.message}`);
  return { result: startResult.message, failed: true };
}
