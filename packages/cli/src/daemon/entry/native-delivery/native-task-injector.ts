import { NATIVE_TASK_INJECTED_ACTION } from '@workspace/backend/src/domain/entities/participant.js';
import {
  shouldEmitSessionAugmentation,
  resolveSessionAugmentationForTask,
  sessionAugmentationNewSessionStarted,
} from '@workspace/backend/src/domain/handoff/parse-session-augmentation.js';
import { Effect } from 'effect';
import { buildActivityLifecycleFact, type AgentLifecycleFact } from '../../domain/entities/agent-lifecycle-fact.js';

import { ensureColdSessionBeforeNativeInject } from './native-cold-session-before-inject.js';
import { buildNativeInjectionPrompt } from './native-task-injector-logic.js';
import { api } from '../../../api.js';
import type { AssignedTaskWithContent } from '../../../daemon/domain/entities/assigned-task.js';
import type { OperationResult } from '../../../infrastructure/services/agent-lifecycle/agent-lifecycle-types.js';
import { getErrorMessage } from '../../../utils/convex-error.js';
import type { StopReason } from '../../domain/entities/stop-reason.js';
import type { AgentSlot } from '../../infrastructure/agent-process-manager/agent-process-manager.js';
import { logDaemonAuditEvent } from '../../infrastructure/event-stream/daemon-event-emitter.js';
import type { AgentHarness } from '../daemon-types.js';

export interface NativeInjectorAgentMgr {
  resumeTurnForSlot: (args: { chatroomId: string; role: string; prompt: string }) => Promise<void>;
  stop: (opts: {
    chatroomId: string;
    role: string;
    reason: StopReason;
  }) => Promise<{ success: boolean }>;
  ensureRunning: (opts: {
    chatroomId: string;
    role: string;
    agentHarness: AgentHarness;
    model: string;
    workingDir: string;
    reason: string;
    wantResume: boolean;
  }) => Promise<OperationResult>;
  getSlot: (chatroomId: string, role: string) => AgentSlot | undefined;
}

export interface NativeInjectorDeps {
  sessionId: string;
  machineId: string;
  logEvent?: (event: Record<string, unknown>) => Promise<void>;
  backend: {
    mutation: (fn: unknown, args: Record<string, unknown>) => Promise<unknown>;
    query: (fn: unknown, args: Record<string, unknown>) => Promise<unknown>;
  };
  agentMgr: NativeInjectorAgentMgr;
  lifecycleOutbox?: { enqueue: (fact: AgentLifecycleFact) => Promise<unknown> };
  convexUrl?: string;
  onTaskDelivered?: (args: { chatroomId: string; role: string; taskId: string }) => void;
}

async function emitTaskDeliveryFailed(
  deps: NativeInjectorDeps,
  args: {
    chatroomId: string;
    role: string;
    taskId?: string;
    error: string;
  }
): Promise<void> {
  try {
    await logDaemonAuditEvent(deps.logEvent ?? (async () => undefined), {
      type: 'agent.taskDeliveryFailed',
      chatroomId: args.chatroomId,
      role: args.role,
      machineId: deps.machineId,
      taskId: args.taskId,
      error: args.error,
    });
  } catch {
    // Non-critical observability
  }
}

function reportDeliveryFailureEffect(
  deps: NativeInjectorDeps,
  args: { chatroomId: string; role: string; taskId: string; error: string }
): Effect.Effect<void, never, never> {
  return Effect.tryPromise({
    try: () => emitTaskDeliveryFailed(deps, args),
    catch: () => undefined,
  }).pipe(Effect.catchAll(() => Effect.void));
}

function applyColdSessionIfRequested(
  task: AssignedTaskWithContent,
  deps: NativeInjectorDeps,
  chatroomId: string,
  role: string,
  taskId: AssignedTaskWithContent['taskId']
): Effect.Effect<{ harnessSessionId: string } | { failed: true; error: string }, never, never> {
  return Effect.gen(function* () {
    const coldSessionResult = yield* Effect.tryPromise({
      try: () => ensureColdSessionBeforeNativeInject(task, deps),
      catch: (err) => err,
    }).pipe(Effect.either);

    if (coldSessionResult._tag === 'Left' || !coldSessionResult.right) {
      const error =
        coldSessionResult._tag === 'Left'
          ? getErrorMessage(coldSessionResult.left)
          : 'cold session restart failed';
      yield* reportDeliveryFailureEffect(deps, {
        chatroomId,
        role,
        taskId: taskId as string,
        error,
      });
      return { failed: true as const, error };
    }

    return { harnessSessionId: coldSessionResult.right };
  });
}

function claimPendingTaskIfNeeded(
  task: AssignedTaskWithContent,
  deps: NativeInjectorDeps
): Effect.Effect<void, unknown, never> {
  return Effect.gen(function* () {
    if (task.status !== 'pending') return;

    const { chatroomId, taskId, agentConfig } = task;
    const { role } = agentConfig;
    const claimResult = yield* Effect.tryPromise({
      try: () =>
        deps.backend.mutation(api.tasks.claimTask, {
          sessionId: deps.sessionId,
          chatroomId,
          role,
          taskId,
        }),
      catch: (err) => err,
    }).pipe(Effect.either);

    if (claimResult._tag === 'Left') {
      yield* reportDeliveryFailureEffect(deps, {
        chatroomId,
        role,
        taskId: taskId as string,
        error: getErrorMessage(claimResult.left),
      });
      return yield* Effect.fail(claimResult.left);
    }
  });
}

function resolveHarnessSessionForInject(
  task: AssignedTaskWithContent,
  deps: NativeInjectorDeps,
  initialHarnessSessionId: string
): Effect.Effect<
  { harnessSessionId: string; sessionAugmentationEmitted: boolean },
  unknown,
  never
> {
  return Effect.gen(function* () {
    const { chatroomId, taskId, agentConfig } = task;
    const { role } = agentConfig;

    if (!task.startInNewSession) {
      return { harnessSessionId: initialHarnessSessionId, sessionAugmentationEmitted: false };
    }

    const coldSession = yield* applyColdSessionIfRequested(task, deps, chatroomId, role, taskId);
    if ('failed' in coldSession) {
      return yield* Effect.fail(new Error(coldSession.error));
    }

    return {
      harnessSessionId: coldSession.harnessSessionId,
      sessionAugmentationEmitted: true,
    };
  });
}

function emitSessionAugmentationIfNeeded(
  task: AssignedTaskWithContent,
  deps: NativeInjectorDeps,
  harnessSessionId: string,
  sessionAugmentationEmitted: boolean,
  augmentationMode: ReturnType<typeof resolveSessionAugmentationForTask>
): Effect.Effect<void, never, never> {
  const { chatroomId, taskId, agentConfig } = task;
  const { role } = agentConfig;
  if (!shouldEmitSessionAugmentation(role, augmentationMode) || sessionAugmentationEmitted) {
    return Effect.void;
  }

  return Effect.tryPromise({
    try: async () => {
      await logDaemonAuditEvent(deps.logEvent ?? (async () => undefined), {
        type: 'agent.sessionAugmented',
        chatroomId,
        role,
        machineId: deps.machineId,
        taskId,
        mode: augmentationMode,
        newSessionStarted: sessionAugmentationNewSessionStarted(augmentationMode),
        harnessSessionId,
      });
      await deps.backend.mutation(api.daemon.agentEvents.sessionAugmented, {
        sessionId: deps.sessionId,
        machineId: deps.machineId,
        chatroomId,
        role,
        taskId,
        mode: augmentationMode,
        newSessionStarted: sessionAugmentationNewSessionStarted(augmentationMode),
        harnessSessionId,
      });
    },
    catch: (err) => err,
  }).pipe(Effect.catchAll(() => Effect.void));
}

function resumeHarnessWithPrompt(
  task: AssignedTaskWithContent,
  deps: NativeInjectorDeps,
  prompt: string
): Effect.Effect<void, unknown, never> {
  return Effect.gen(function* () {
    const { chatroomId, taskId, agentConfig } = task;
    const { role } = agentConfig;

    const resumeResult = yield* Effect.tryPromise({
      try: () => deps.agentMgr.resumeTurnForSlot({ chatroomId, role, prompt }),
      catch: (err) => err,
    }).pipe(Effect.either);

    if (resumeResult._tag === 'Left') {
      const error = getErrorMessage(resumeResult.left);
      console.warn(`[NativeTaskInjector] resumeTurn failed for ${role}@${chatroomId}: ${error}`);
      yield* reportDeliveryFailureEffect(deps, {
        chatroomId,
        role,
        taskId: taskId as string,
        error,
      });
      return;
    }

    yield* Effect.tryPromise({
      try: () =>
        logDaemonAuditEvent(deps.logEvent ?? (async () => undefined), {
          type: 'agent.taskDelivered',
          chatroomId,
          role,
          machineId: deps.machineId,
          taskId,
        }),
      catch: (err) => err,
    }).pipe(Effect.catchAll(() => Effect.void));

    deps.onTaskDelivered?.({ chatroomId, role, taskId: taskId as string });
  });
}

function loadNativeInjectionPrompt(
  task: AssignedTaskWithContent,
  deps: NativeInjectorDeps
): Effect.Effect<
  { prompt: string; augmentationMode: ReturnType<typeof resolveSessionAugmentationForTask> },
  unknown,
  never
> {
  return Effect.gen(function* () {
    const { chatroomId, taskId, taskContent, agentConfig } = task;
    const { role } = agentConfig;

    const deliveryResult = yield* Effect.tryPromise({
      try: () =>
        deps.backend.query(api.messages.getTaskDeliveryPrompt, {
          sessionId: deps.sessionId,
          chatroomId,
          role,
          taskId,
          convexUrl: deps.convexUrl,
        }) as Promise<{ fullCliOutput: string }>,
      catch: (err) => err,
    }).pipe(Effect.either);

    if (deliveryResult._tag === 'Left') {
      yield* reportDeliveryFailureEffect(deps, {
        chatroomId,
        role,
        taskId: taskId as string,
        error: getErrorMessage(deliveryResult.left),
      });
      return yield* Effect.fail(deliveryResult.left);
    }

    const augmentationMode = resolveSessionAugmentationForTask(
      { content: taskContent, startInNewSession: task.startInNewSession },
      role
    );

    return {
      augmentationMode,
      prompt: buildNativeInjectionPrompt({
        taskDeliveryOutput: deliveryResult.right.fullCliOutput,
        augmentationMode,
      }),
    };
  });
}

function injectNativeTaskPrompt(
  task: AssignedTaskWithContent,
  deps: NativeInjectorDeps,
  harnessSessionId: string,
  sessionAugmentationEmitted: boolean
): Effect.Effect<void, unknown, never> {
  return Effect.gen(function* () {
    const { chatroomId, taskId, agentConfig } = task;
    const { role } = agentConfig;
    const { prompt, augmentationMode } = yield* loadNativeInjectionPrompt(task, deps);

    yield* Effect.tryPromise({
      try: () =>
        deps.lifecycleOutbox
          ? deps.lifecycleOutbox.enqueue(buildActivityLifecycleFact({ chatroomId, role, action: NATIVE_TASK_INJECTED_ACTION, taskId }))
          : Promise.resolve(),
      catch: (err) => err,
    });

    yield* Effect.tryPromise({
      try: () =>
        deps.backend.mutation(api.taskDeliveryReceipts.record, {
          sessionId: deps.sessionId,
          chatroomId,
          taskId,
          role,
          deliveryKind: 'native_inject',
          harnessSessionId,
        }),
      catch: (err) => err,
    });

    yield* emitSessionAugmentationIfNeeded(
      task,
      deps,
      harnessSessionId,
      sessionAugmentationEmitted,
      augmentationMode
    );

    yield* resumeHarnessWithPrompt(task, deps, prompt);
  });
}

export function runNativeInjectionEffect(
  task: AssignedTaskWithContent,
  initialHarnessSessionId: string,
  deps: NativeInjectorDeps
): Effect.Effect<void, unknown, never> {
  return Effect.gen(function* () {
    yield* claimPendingTaskIfNeeded(task, deps);
    const session = yield* resolveHarnessSessionForInject(task, deps, initialHarnessSessionId);
    yield* injectNativeTaskPrompt(
      task,
      deps,
      session.harnessSessionId,
      session.sessionAugmentationEmitted
    );
  });
}
