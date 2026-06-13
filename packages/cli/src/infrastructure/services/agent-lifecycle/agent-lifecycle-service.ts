/**
 * AgentLifecycleService — Effect-native agent lifecycle orchestration.
 *
 * Uses Phase 1 domain functions (transitionSlot, decideRestartAfterExit, etc.)
 * with Effect primitives (Ref, acquireRelease, Schedule, Fiber) for
 * concurrent spawn/stop/exit management.
 *
 * Standalone — no AgentProcessManager wiring (Phase 3).
 */

import { Layer, Effect, Ref, Duration } from 'effect';

import type {
  AgentLifecycleSlot,
  EnsureRunningOpts,
  StopOpts,
  HandleExitOpts,
  OperationResult,
} from './agent-lifecycle-types.js';
import { AgentLifecycleService, AgentLifecyclePorts } from './agent-lifecycle-types.js';
import {
  agentKey,
  transitionSlot,
  shouldIgnoreProcessExit,
  decideRestartAfterExit,
  shouldBypassConcurrentLimit,
  resolveStopReason,
  idleSlot,
} from '../../../domain/agent-lifecycle/index.js';
import { createSpawnPrompt } from '../remote-agents/spawn-prompt.js';

// ─── Service Live Layer ────────────────────────────────────────────────────────

export const AgentLifecycleServiceLive: Layer.Layer<
  AgentLifecycleService,
  never,
  AgentLifecyclePorts
> = Layer.effect(
  AgentLifecycleService,
  Effect.gen(function* () {
    const ports = yield* AgentLifecyclePorts;

    // Ref-backed slot store, keyed by agentKey(chatroomId, role)
    const slotsRef = yield* Ref.make(new Map<string, AgentLifecycleSlot>());

    const getSlotFromRef = (key: string): Effect.Effect<AgentLifecycleSlot | undefined> =>
      Ref.get(slotsRef).pipe(Effect.map((map: Map<string, AgentLifecycleSlot>) => map.get(key)));

    const setSlotInRef = (key: string, slot: AgentLifecycleSlot): Effect.Effect<void> =>
      Ref.update(slotsRef, (map: Map<string, AgentLifecycleSlot>) => map.set(key, slot));

    const removeSlotFromRef = (key: string): Effect.Effect<void> =>
      Ref.update(slotsRef, (map: Map<string, AgentLifecycleSlot>) => {
        const next = new Map(map);
        next.delete(key);
        return next;
      });

    // ── ensureRunning ────────────────────────────────────────────────────────
    // Note: We do NOT use acquireRelease here because the spawned agent
    // keeps running after ensureRunning returns. The bracket's release
    // would fire immediately, decrementing the count prematurely.
    // Instead, we call recordSpawn directly and recordExit in handleExit/stop.

    const ensureRunning = (opts: EnsureRunningOpts): Effect.Effect<OperationResult> =>
      Effect.gen(function* () {
        const key = agentKey(opts.chatroomId, opts.role);

        // Read current slot
        const currentSlot = yield* getSlotFromRef(key);

        if (currentSlot && currentSlot.state !== 'idle') {
          // Already spawning/running/stopping — return existing state info
          return {
            success: true,
            pid: currentSlot.pid,
          };
        }

        // Check concurrent limit via port
        const bypass = shouldBypassConcurrentLimit(opts.reason);
        const allowResult = ports.spawn.shouldAllowSpawn(
          opts.chatroomId,
          opts.reason,
          bypass ? { bypassConcurrentLimit: true } : undefined
        );

        if (!allowResult.allowed) {
          const error: OperationResult['error'] = allowResult.retryAfterMs
            ? 'rate_limited'
            : 'backoff';
          return { success: false, error };
        }

        // Build initial idle slot and transition through spawn
        let slot: AgentLifecycleSlot = {
          ...idleSlot(),
          harness: opts.agentHarness,
          model: opts.model,
          workingDir: opts.workingDir,
          wantResume: opts.wantResume,
        };

        // Transition: spawn_started
        const startedResult = transitionSlot(slot, {
          type: 'spawn_started',
          operationKey: opts.reason,
        });
        if (!startedResult.ok) {
          return { success: false, error: 'spawn_failed' };
        }
        slot = startedResult.slot;

        // Spawn via harness port — absorb Error into OperationResult
        const spawnHandle = yield* ports.harness
          .spawn({
            harness: opts.agentHarness,
            chatroomId: opts.chatroomId,
            role: opts.role,
            workingDir: opts.workingDir,
            model: opts.model,
            prompt: createSpawnPrompt(opts.initPrompt),
            systemPrompt: opts.systemPrompt,
          })
          .pipe(Effect.catchAll(() => Effect.succeed(null)));

        if (!spawnHandle) {
          return { success: false, error: 'spawn_failed' };
        }

        // Transition: spawn_succeeded
        const succeededResult = transitionSlot(slot, {
          type: 'spawn_succeeded',
          pid: spawnHandle.pid,
        });
        if (!succeededResult.ok) {
          return { success: false, error: 'spawn_failed' };
        }
        slot = succeededResult.slot;

        // Record spawn (paired with recordExit in handleExit/stop)
        yield* ports.spawn.recordSpawn(opts.chatroomId);

        // Save slot to Ref for later access
        yield* setSlotInRef(key, slot);

        // Wire onAgentEnd callback from spawn result
        if (spawnHandle) {
          spawnHandle.onAgentEnd(() => {
            // Phase 3: emit turn-completed, check for resume-storm
          });
        }

        // Store harnessSessionId on slot after spawn_succeeded
        if (spawnHandle && spawnHandle.harnessSessionId) {
          const updatedSlot = { ...slot, harnessSessionId: spawnHandle.harnessSessionId };
          yield* setSlotInRef(key, updatedSlot);
        }

        return { success: true, pid: slot.pid };
      });

    // ── stop ─────────────────────────────────────────────────────────────────

    const stop = (opts: StopOpts): Effect.Effect<{ success: boolean }> =>
      Effect.gen(function* () {
        const key = agentKey(opts.chatroomId, opts.role);
        const slot = yield* getSlotFromRef(key);

        if (!slot) {
          return { success: false };
        }

        // Set stopping state BEFORE async stop call (race guard)
        const stoppingResult = transitionSlot(slot, {
          type: 'stop_requested',
          operationKey: opts.reason,
        });

        if (!stoppingResult.ok) {
          return { success: false };
        }

        const stoppingSlot = stoppingResult.slot;
        yield* setSlotInRef(key, stoppingSlot);

        // Actual stop via harness port (if pid exists)
        if (stoppingSlot.pid) {
          yield* ports.harness
            .stop(stoppingSlot.pid, { preserveForResume: false })
            .pipe(Effect.ignore);
        }

        // Always recordExit (fixes concurrent count leak)
        yield* ports.spawn.recordExit(opts.chatroomId);

        // Transition to idle via stop_completed
        const completedResult = transitionSlot(stoppingSlot, {
          type: 'stop_completed',
        });
        if (completedResult.ok) {
          yield* setSlotInRef(key, completedResult.slot);
        }

        return { success: true };
      });

    // ── handleExit ───────────────────────────────────────────────────────────
    // Handles process exit: transitions slot, decides restart, calls recordExit.
    // No acquireRelease — recordExit called directly (ensureRunning handles errors gracefully).

    const handleExit = (opts: HandleExitOpts): Effect.Effect<void> =>
      Effect.gen(function* () {
        const key = agentKey(opts.chatroomId, opts.role);
        const slot = yield* getSlotFromRef(key);

        if (!slot) {
          return;
        }

        // Early return if shouldIgnoreProcessExit (stopping state)
        if (shouldIgnoreProcessExit(slot, opts.pid)) {
          return;
        }

        // Resolve stop reason from exit info
        const stopReason = resolveStopReason(opts.code, opts.signal);

        // Apply transitionSlot with process_exited
        const transitionResult = transitionSlot(slot, {
          type: 'process_exited',
          pid: opts.pid,
        });

        if (!transitionResult.ok) {
          // StalePid or IgnoredDuplicateExit — ignore
          return;
        }

        const exitedSlot = transitionResult.slot;
        yield* setSlotInRef(key, exitedSlot);

        // Decide restart
        const restartOutcome = decideRestartAfterExit({
          stopReason,
          harness: slot.harness,
          workingDir: slot.workingDir,
          wantResume: slot.wantResume ?? false,
          isPermanentFailure: false,
          restartAllowed: true,
        });

        switch (restartOutcome._tag) {
          case 'RestartNow': {
            // Retry restart — call ensureRunning (returns { success: false } on rate limit)
            if (!slot.harness) {
              yield* Effect.logError(`Agent restart failed for ${key}: missing harness`);
              break;
            }
            const restartResult = yield* ensureRunning({
              chatroomId: opts.chatroomId,
              role: opts.role,
              agentHarness: slot.harness,
              workingDir: slot.workingDir ?? '',
              reason: restartOutcome.spawnReason,
              wantResume: restartOutcome.wantResume,
            });

            if (!restartResult.success && restartResult.error) {
              yield* Effect.logError(`Agent restart failed for ${key}: ${restartResult.error}`);
            }
            break;
          }

          case 'ScheduleRetry': {
            // Fork supervised fiber with backoff delay
            if (!slot.harness) {
              yield* Effect.logError(`Agent restart failed for ${key}: missing harness`);
              break;
            }
            yield* Effect.forkDaemon(
              Effect.sleep(Duration.millis(restartOutcome.waitMs)).pipe(
                Effect.as(
                  ensureRunning({
                    chatroomId: opts.chatroomId,
                    role: opts.role,
                    agentHarness: slot.harness,
                    workingDir: slot.workingDir ?? '',
                    reason: restartOutcome.spawnReason,
                    wantResume: restartOutcome.wantResume,
                  })
                )
              )
            );
            break;
          }

          case 'NoRestart': {
            // Clean exit — remove the slot
            yield* removeSlotFromRef(key);
            break;
          }
        }

        // Always call recordExit (paired with recordSpawn from ensureRunning)
        yield* ports.spawn.recordExit(opts.chatroomId);
      });

    // ── Public API ───────────────────────────────────────────────────────────

    const getSlot = (chatroomId: string, role: string) =>
      getSlotFromRef(agentKey(chatroomId, role));

    const listActive = (): Effect.Effect<
      readonly { chatroomId: string; role: string; slot: AgentLifecycleSlot }[]
    > =>
      Ref.get(slotsRef).pipe(
        Effect.map((map: Map<string, AgentLifecycleSlot>) => {
          const results: { chatroomId: string; role: string; slot: AgentLifecycleSlot }[] = [];
          for (const [key, slot] of map) {
            if (slot.state !== 'idle') {
              const [chatroomId, role] = key.split(':');
              results.push({ chatroomId, role, slot });
            }
          }
          return results;
        })
      );

    return {
      ensureRunning,
      stop,
      handleExit,
      getSlot,
      listActive,
    };
  })
);
