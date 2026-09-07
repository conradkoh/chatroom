/**
 * AgentLifecycleService — Effect-native agent lifecycle orchestration.
 *
 * Uses Phase 1 domain functions (transitionSlot, decideRestartAfterExit, etc.)
 * with Effect primitives (Ref, acquireRelease, Schedule, Fiber) for
 * concurrent spawn/stop/exit management.
 *
 * Standalone — no AgentProcessManager wiring (Phase 3).
 */

import { Layer, Effect, Ref } from 'effect';

import type {
  AgentLifecycleSlot,
  EnsureRunningOpts,
  StopOpts,
  HandleExitOpts,
  OperationResult,
} from './agent-lifecycle-types.js';
import { AgentLifecycleService, AgentLifecyclePorts } from './agent-lifecycle-types.js';
import { agentKey, idleSlot } from '../../../daemon/domain/entities/agent-slot.js';
import {
  transitionSlot,
  shouldIgnoreProcessExit,
} from '../../../daemon/domain/usecase/transition-agent-slot.js';
import { createSpawnPrompt } from '../../../daemon/infrastructure/local/harness/services/spawn-prompt.js';

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

    const spawnAndRegister = (
      key: string,
      opts: EnsureRunningOpts
    ): Effect.Effect<OperationResult> =>
      Effect.gen(function* () {
        let slot: AgentLifecycleSlot = {
          ...idleSlot(),
          harness: opts.agentHarness,
          model: opts.model,
          workingDir: opts.workingDir,
          wantResume: opts.wantResume,
          _initPrompt: opts.initPrompt ?? '',
          _systemPrompt: opts.systemPrompt,
        };

        const startedResult = transitionSlot(slot, {
          type: 'spawn_started',
          operationKey: opts.reason,
        });
        if (!startedResult.ok) {
          return { success: false, error: 'spawn_failed' };
        }
        slot = startedResult.slot;

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

        const succeededResult = transitionSlot(slot, {
          type: 'spawn_succeeded',
          pid: spawnHandle.pid,
        });
        if (!succeededResult.ok) {
          return { success: false, error: 'spawn_failed' };
        }
        slot = succeededResult.slot;

        yield* setSlotInRef(key, slot);

        if (spawnHandle) {
          spawnHandle.onAgentEnd(() => {
            // Phase 3: emit turn-completed, check for resume-storm
          });
        }

        if (spawnHandle && spawnHandle.harnessSessionId) {
          const updatedSlot = { ...slot, harnessSessionId: spawnHandle.harnessSessionId };
          yield* setSlotInRef(key, updatedSlot);
        }

        return { success: true, pid: slot.pid };
      });

    const ensureRunning = (opts: EnsureRunningOpts): Effect.Effect<OperationResult> =>
      Effect.gen(function* () {
        const key = agentKey(opts.chatroomId, opts.role);

        const currentSlot = yield* getSlotFromRef(key);

        if (currentSlot && currentSlot.state !== 'idle') {
          if (
            opts.lifecycleRevision !== undefined &&
            currentSlot.authorizedLifecycleRevision !== opts.lifecycleRevision
          ) {
            return { success: false, error: 'stale_revision' };
          }
          return {
            success: true,
            pid: currentSlot.pid,
          };
        }

        const allowResult = ports.spawn.shouldAllowSpawn(opts.chatroomId, opts.reason);
        if (!allowResult.allowed) {
          const error: OperationResult['error'] = allowResult.retryAfterMs
            ? 'rate_limited'
            : 'backoff';
          return { success: false, error };
        }

        const result = yield* spawnAndRegister(key, opts);

        if (!result.success && result.error) {
          yield* Effect.logError(`Agent spawn failed for ${key}: ${result.error}`);
        }

        return result;
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
            .stop(
              stoppingSlot.pid,
              (stoppingSlot as AgentLifecycleSlot).harness
            )
            .pipe(Effect.ignore);
        }

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

    const handleExit = (opts: HandleExitOpts): Effect.Effect<void> =>
      Effect.gen(function* () {
        const key = agentKey(opts.chatroomId, opts.role);
        const slot = yield* getSlotFromRef(key);

        if (!slot) {
          return;
        }

        if (shouldIgnoreProcessExit(slot, opts.pid)) {
          return;
        }

        const transitionResult = transitionSlot(slot, {
          type: 'process_exited',
          pid: opts.pid,
        });

        if (!transitionResult.ok) {
          return;
        }

        const exitedSlot = {
          ...transitionResult.slot,
          _stopReasonCode: opts.code,
          _stopReasonSignal: opts.signal,
          harness: slot.harness,
          workingDir: slot.workingDir,
          wantResume: slot.wantResume,
          _initPrompt: slot._initPrompt,
          _systemPrompt: slot._systemPrompt,
        } as AgentLifecycleSlot;
        yield* setSlotInRef(key, exitedSlot);
        yield* removeSlotFromRef(key);
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

    const reset = (input: {
      readonly scope: 'chatroom' | 'chatroom-role';
      readonly chatroomId: string;
      readonly role?: string;
    }): Effect.Effect<void> =>
      Ref.update(slotsRef, (map) => {
        const next = new Map(map);
        const prefix = `${input.chatroomId}:`;
        const exactKey =
          input.scope === 'chatroom-role' && input.role
            ? `${input.chatroomId}:${input.role.toLowerCase()}`
            : undefined;
        for (const key of next.keys()) {
          if (input.scope === 'chatroom' ? key.startsWith(prefix) : key === exactKey) {
            next.delete(key);
          }
        }
        return next;
      });

    return {
      ensureRunning,
      stop,
      handleExit,
      getSlot,
      listActive,
      reset,
    };
  })
);
