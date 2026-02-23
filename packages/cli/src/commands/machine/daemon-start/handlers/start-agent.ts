/**
 * Start Agent Command Handler — spawns an agent process for a chatroom role.
 */

import { api } from '../../../../api.js';
import { getConvexUrl } from '../../../../infrastructure/convex/client.js';
import type { CommandResult, DaemonContext, StartAgentCommand } from '../types.js';

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

  // Spawn via RemoteAgentService
  const combinedPrompt = `${initPromptResult.rolePrompt}\n\n${initPromptResult.initialMessage}`;

  let spawnResult;
  try {
    spawnResult = await ctx.remoteAgentService.spawn({
      workingDir,
      prompt: combinedPrompt,
      model,
      context: { machineId: ctx.machineId, chatroomId, role },
    });
  } catch (e) {
    const msg = `Failed to spawn agent: ${(e as Error).message}`;
    console.log(`   ⚠️  ${msg}`);
    return { result: msg, failed: true };
  }

  const { pid } = spawnResult;
  const msg = `Agent spawned (PID: ${pid})`;
  console.log(`   ✅ ${msg}`);

  // Update backend with spawned agent PID and persist locally
  try {
    await ctx.deps.backend.mutation(api.machines.updateSpawnedAgent, {
      sessionId: ctx.sessionId,
      machineId: ctx.machineId,
      chatroomId,
      role,
      pid,
      model,
    });
    console.log(`   Updated backend with PID: ${pid}`);

    ctx.deps.machine.persistAgentPid(ctx.machineId, chatroomId, role, pid, agentHarness);
  } catch (e) {
    console.log(`   ⚠️  Failed to update PID in backend: ${(e as Error).message}`);
  }

  ctx.events.emit('agent:started', {
    chatroomId,
    role,
    pid,
    harness: agentHarness,
    model,
  });

  // Monitor for process exit — emit event so centralized listeners handle cleanup.
  spawnResult.onExit(({ code, signal }) => {
    const wasIntentional = ctx.deps.stops.consume(chatroomId, role);
    ctx.events.emit('agent:exited', {
      chatroomId,
      role,
      pid,
      code,
      signal,
      intentional: wasIntentional,
    });
  });

  // Track lastSeenTokenAt — report to backend at most once per 30s,
  // and only when the timestamp has actually changed (avoid redundant writes).
  let lastReportedTokenAt = 0;
  spawnResult.onOutput(() => {
    const now = Date.now();
    if (now - lastReportedTokenAt >= 30_000) {
      lastReportedTokenAt = now;
      ctx.deps.backend
        .mutation(api.participants.updateTokenActivity, {
          sessionId: ctx.sessionId,
          chatroomId,
          role,
        })
        .catch(() => {}); // fire-and-forget — non-critical
    }
  });

  return { result: msg, failed: false };
}
