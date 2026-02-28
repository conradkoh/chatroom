/**
 * Start Agent Command Handler — spawns an agent process for a chatroom role.
 */

import { api } from '../../../../api.js';
import type { Id } from '../../../../api.js';
import { getConvexUrl } from '../../../../infrastructure/convex/client.js';
import { onAgentShutdown } from '../../../../events/lifecycle/on-agent-shutdown.js';
import type { CommandResult, DaemonContext, StartAgentCommand, StartAgentReason } from '../types.js';

/**
 * Execute the start-agent logic for a given set of explicit args.
 *
 * This is the canonical implementation — `handleStartAgent` is a thin wrapper
 * that maps a command envelope to these args. Stream-based callers can invoke
 * this directly without constructing a full command object.
 */
export async function executeStartAgent(
  ctx: DaemonContext,
  args: {
    chatroomId: Id<'chatroom_rooms'>;
    role: string;
    agentHarness: 'opencode' | 'pi';
    model?: string;
    workingDir?: string;
    reason: StartAgentReason;
  }
): Promise<CommandResult> {
  const { chatroomId, role, agentHarness, model, workingDir, reason } = args;
  console.log(`   ↪ start-agent command received`);
  console.log(`      Chatroom: ${chatroomId}`);
  console.log(`      Role: ${role}`);
  console.log(`      Harness: ${agentHarness}`);
  if (reason) {
    console.log(`      Reason: ${reason}`);
  }
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

  // Kill any existing agent for this (chatroomId, role) before spawning.
  // This prevents duplicate/ghost agents when start-agent is called while a
  // previous instance is still running (e.g. slow agent, ensureAgentHandler firing).
  // We collect PIDs from two sources:
  //   1. Backend (authoritative DB record)
  //   2. Local daemon state (may diverge if updateSpawnedAgent mutation failed)
  // Both are killed to ensure no ghost processes survive.
  // Fail-open: if the backend query errors, skip the pre-kill and proceed with spawn.
  try {
    const existingConfigs = await ctx.deps.backend.query(api.machines.getAgentConfigs, {
      sessionId: ctx.sessionId,
      chatroomId,
    });
    const existingConfig = existingConfigs.configs.find(
      (c: { machineId: string; role: string; spawnedAgentPid?: number }) =>
        c.machineId === ctx.machineId && c.role.toLowerCase() === role.toLowerCase()
    );
    const backendPid = existingConfig?.spawnedAgentPid;

    // Also check local daemon state — it may differ from the backend if a
    // previous updateSpawnedAgent mutation failed or a race left a stale entry.
    const localEntry = ctx.deps.machine
      .listAgentEntries(ctx.machineId)
      .find((e) => e.chatroomId === chatroomId && e.role.toLowerCase() === role.toLowerCase());
    const localPid = localEntry?.entry.pid;

    // Deduplicate: build a set of all PIDs to kill from both sources.
    const pidsToKill = [
      ...new Set([backendPid, localPid].filter((p): p is number => p !== undefined)),
    ];

    const anyService = ctx.agentServices.values().next().value;
    for (const pid of pidsToKill) {
      const isAlive = anyService ? anyService.isAlive(pid) : false;
      if (isAlive) {
        console.log(`   ⚠️  Existing agent detected (PID: ${pid}) — stopping before respawn`);
        await onAgentShutdown(ctx, { chatroomId, role, pid });
        console.log(`   ✅ Existing agent stopped (PID: ${pid})`);
      }
    }
  } catch (e) {
    console.log(`   ⚠️  Could not check for existing agent (proceeding): ${(e as Error).message}`);
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

  // Spawn via the appropriate RemoteAgentService for the requested harness
  const service = ctx.agentServices.get(agentHarness);
  if (!service) {
    const msg = `Unknown agent harness: ${agentHarness}`;
    console.log(`   ⚠️  ${msg}`);
    return { result: msg, failed: true };
  }

  // Spawn with split prompt: systemPrompt (rolePrompt) + prompt (initialMessage)
  // Each service handles the split differently:
  // - OpenCodeAgentService: combines them and pipes via stdin
  // - PiAgentService: passes them as --system-prompt and positional arg
  let spawnResult;
  try {
    spawnResult = await service.spawn({
      workingDir,
      prompt: initPromptResult.initialMessage,
      systemPrompt: initPromptResult.rolePrompt,
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

/**
 * Handle a start-agent command — thin wrapper around executeStartAgent.
 *
 * The working directory MUST be provided in the command payload by the caller
 * (frontend / backend). The daemon never resolves or caches working directories locally.
 */
export async function handleStartAgent(
  ctx: DaemonContext,
  command: StartAgentCommand
): Promise<CommandResult> {
  return executeStartAgent(ctx, {
    chatroomId: command.payload.chatroomId,
    role: command.payload.role,
    agentHarness: command.payload.agentHarness,
    model: command.payload.model,
    workingDir: command.payload.workingDir,
    reason: command.reason,
  });
}
