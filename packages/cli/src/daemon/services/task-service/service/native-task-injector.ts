import { NATIVE_TASK_INJECTED_ACTION } from '@workspace/backend/src/domain/entities/participant.js';
import {
  shouldEmitSessionAugmentation,
  resolveSessionAugmentationForTask,
  sessionAugmentationNewSessionStarted,
  taskRequestsNativeColdSession,
} from '@workspace/backend/src/domain/handoff/parse-session-augmentation.js';
import { Effect } from 'effect';

import { ensureColdSessionBeforeNativeInject } from './native-cold-session-before-inject.js';
import type {
  NativeTaskDeliveryAgentPort,
  NativeTaskDeliveryAuditPort,
  NativeTaskDeliveryGateway,
} from './ports/native-task-delivery.js';
import { getErrorMessage } from '../../../../utils/convex-error.js';
import {
  buildActivityLifecycleFact,
  type AgentLifecycleFact,
} from '../../../domain/entities/agent-lifecycle-fact.js';
import type { AssignedTaskWithContent } from '../../../domain/entities/assigned-task.js';
import type { AgentKey, SerializedAgentOperations } from '../../agent-process-contracts.js';
import type { AgentConfigRegistry } from '../../chatroom-workspace-configuration-service/index.js';
import { buildNativeInjectionPrompt } from '../domain/usecase/native-task-injector-logic.js';

export type NativeInjectorAgentMgr = NativeTaskDeliveryAgentPort;

/** Shared daemon session + backend handles for native delivery. */
export interface NativeDeliverySessionHandles {
  sessionId: string;
  machineId: string;
  logEvent?: ((event: Record<string, unknown>) => Promise<void>) | undefined;
  /** Legacy transport handle retained for composition adapters. */
  backend: {
    mutation: (fn: unknown, args: Record<string, unknown>) => Promise<unknown>;
    query: (fn: unknown, args: Record<string, unknown>) => Promise<unknown>;
  };
}

export interface NativeInjectorDeps extends NativeDeliverySessionHandles {
  isCurrent?: (() => boolean) | undefined;
  /** Daemon-local source of agent harness/model/workingDir configuration. */
  configurationService: AgentConfigRegistry;
  agentMgr: NativeInjectorAgentMgr;
  /** Narrow coordination capability used by the cold-session flow. */
  runSerializedForAgent: <T>(
    key: AgentKey,
    options: { timeoutMs: number },
    operation: (ops: SerializedAgentOperations, context: { signal: AbortSignal }) => Promise<T>
  ) => Promise<T>;
  lifecycleOutbox?: { enqueue: (fact: AgentLifecycleFact) => Promise<unknown> } | undefined;
  convexUrl?: string | undefined;
  taskGateway: NativeTaskDeliveryGateway;
  audit: NativeTaskDeliveryAuditPort;
  onTaskDelivered?:
    | ((args: {
        chatroomId: string;
        role: string;
        taskId: string;
        harnessSessionId: string;
      }) => void)
    | undefined;
}

class NativeDeliveryCancelledError extends Error {
  constructor() {
    super('native delivery attempt was cancelled');
    this.name = 'NativeDeliveryCancelledError';
  }
}

function ensureCurrent(deps: NativeInjectorDeps): void {
  if (deps.isCurrent?.() === false) throw new NativeDeliveryCancelledError();
}

async function emitTaskDeliveryFailed(
  deps: NativeInjectorDeps,
  args: {
    chatroomId: string;
    role: string;
    taskId?: string | undefined;
    error: string;
  }
): Promise<void> {
  if (deps.isCurrent?.() === false) return;
  try {
    await deps.audit.emit({
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
  }).pipe(Effect.catch(() => Effect.void));
}

function applyColdSessionIfRequested(
  task: AssignedTaskWithContent,
  deps: NativeInjectorDeps,
  chatroomId: string,
  role: string,
  taskId: AssignedTaskWithContent['taskId']
): Effect.Effect<{ harnessSessionId: string } | { failed: true; error: string }, never, never> {
  return Effect.gen(function* () {
    ensureCurrent(deps);
    const coldSessionResult = yield* Effect.tryPromise({
      try: () => ensureColdSessionBeforeNativeInject(task, deps),
      catch: (err) => err,
    }).pipe(Effect.result);
    ensureCurrent(deps);

    if (coldSessionResult._tag === 'Failure' || !coldSessionResult.success) {
      const error =
        coldSessionResult._tag === 'Failure'
          ? getErrorMessage(coldSessionResult.failure)
          : 'cold session restart failed';
      yield* reportDeliveryFailureEffect(deps, {
        chatroomId,
        role,
        taskId: taskId as string,
        error,
      });
      return { failed: true as const, error };
    }

    return { harnessSessionId: coldSessionResult.success };
  });
}

function claimTaskForDelivery(
  task: AssignedTaskWithContent,
  deps: NativeInjectorDeps
): Effect.Effect<void, unknown, never> {
  return Effect.gen(function* () {
    ensureCurrent(deps);
    const { chatroomId, taskId, agentConfig } = task;
    const { role } = agentConfig;
    const claimResult = yield* Effect.tryPromise({
      try: () =>
        deps.taskGateway.claimPendingTask({
          sessionId: deps.sessionId,
          chatroomId,
          role,
          taskId,
        }),
      catch: (err) => err,
    }).pipe(Effect.result);
    ensureCurrent(deps);

    if (claimResult._tag === 'Failure') {
      yield* reportDeliveryFailureEffect(deps, {
        chatroomId,
        role,
        taskId: taskId as string,
        error: getErrorMessage(claimResult.failure),
      });
      return yield* Effect.fail(claimResult.failure);
    }
  });
}

type HarnessSessionResolution =
  | { readonly kind: 'use-existing'; readonly harnessSessionId: string }
  | { readonly kind: 'cold-start' }
  | { readonly kind: 'missing' };

/**
 * Decide how to obtain a harness session without performing any effect.
 * Continue policy requires an existing real session; an absent session must
 * fail before receipt/injection rather than leak a placeholder.
 */
function resolveHarnessSessionPolicy(
  task: AssignedTaskWithContent,
  initialHarnessSessionId: string | undefined
): HarnessSessionResolution {
  if (
    !taskRequestsNativeColdSession({
      content: task.taskContent ?? '',
      taskEnvelope: task.taskEnvelope,
      startInNewSession: task.startInNewSession,
    })
  ) {
    if (!initialHarnessSessionId) return { kind: 'missing' };
    return { kind: 'use-existing', harnessSessionId: initialHarnessSessionId };
  }
  return { kind: 'cold-start' };
}

function resolveHarnessSessionForInject(
  task: AssignedTaskWithContent,
  deps: NativeInjectorDeps,
  initialHarnessSessionId: string | undefined
): Effect.Effect<
  { harnessSessionId: string; sessionAugmentationEmitted: boolean },
  unknown,
  never
> {
  return Effect.gen(function* () {
    ensureCurrent(deps);
    const { chatroomId, taskId, agentConfig } = task;
    const { role } = agentConfig;

    const policy = resolveHarnessSessionPolicy(task, initialHarnessSessionId);
    if (policy.kind === 'missing') {
      return yield* Effect.fail(new Error('harness session missing for continue inject'));
    }
    if (policy.kind === 'use-existing') {
      return { harnessSessionId: policy.harnessSessionId, sessionAugmentationEmitted: false };
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
  const isCurrent = deps.isCurrent ?? (() => true);
  const { chatroomId, taskId, agentConfig } = task;
  const { role } = agentConfig;
  if (!shouldEmitSessionAugmentation(role, augmentationMode) || sessionAugmentationEmitted) {
    return Effect.void;
  }

  return Effect.tryPromise({
    try: async () => {
      if (!isCurrent()) return;
      await deps.audit.emit({
        type: 'agent.sessionAugmented',
        chatroomId,
        role,
        machineId: deps.machineId,
        taskId,
        mode: augmentationMode,
        newSessionStarted: sessionAugmentationNewSessionStarted(augmentationMode),
        harnessSessionId,
      });
      if (!isCurrent()) return;
      await deps.taskGateway.recordSessionAugmentation({
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
  }).pipe(Effect.catch(() => Effect.void));
}

function resumeHarnessWithPrompt(
  task: AssignedTaskWithContent,
  deps: NativeInjectorDeps,
  prompt: string,
  harnessSessionId: string
): Effect.Effect<void, unknown, never> {
  return Effect.gen(function* () {
    ensureCurrent(deps);
    const { chatroomId, taskId, agentConfig } = task;
    const { role } = agentConfig;

    const resumeResult = yield* Effect.tryPromise({
      try: () => deps.agentMgr.resumeTurnForSlot({ chatroomId, role, prompt }),
      catch: (err) => err,
    }).pipe(Effect.result);
    ensureCurrent(deps);

    if (resumeResult._tag === 'Failure') {
      const error = getErrorMessage(resumeResult.failure);
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
        deps.audit.emit({
          type: 'agent.taskDelivered',
          chatroomId,
          role,
          machineId: deps.machineId,
          taskId,
        }),
      catch: (err) => err,
    }).pipe(Effect.catch(() => Effect.void));

    ensureCurrent(deps);
    deps.onTaskDelivered?.({
      chatroomId,
      role,
      taskId: taskId as string,
      harnessSessionId,
    });
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
    ensureCurrent(deps);
    const { chatroomId, taskId, taskContent, agentConfig } = task;
    const { role } = agentConfig;

    const deliveryResult = yield* Effect.tryPromise({
      try: () =>
        deps.taskGateway.loadDeliveryPrompt({
          sessionId: deps.sessionId,
          chatroomId,
          role,
          taskId,
          ...(deps.convexUrl ? { convexUrl: deps.convexUrl } : {}),
        }) as Promise<{ fullCliOutput: string }>,
      catch: (err) => err,
    }).pipe(Effect.result);
    ensureCurrent(deps);

    if (deliveryResult._tag === 'Failure') {
      yield* reportDeliveryFailureEffect(deps, {
        chatroomId,
        role,
        taskId: taskId as string,
        error: getErrorMessage(deliveryResult.failure),
      });
      return yield* Effect.fail(deliveryResult.failure);
    }

    const augmentationMode = resolveSessionAugmentationForTask(
      {
        content: taskContent,
        taskEnvelope: task.taskEnvelope,
        startInNewSession: task.startInNewSession,
      },
      role
    );

    return {
      augmentationMode,
      prompt: buildNativeInjectionPrompt({
        taskDeliveryOutput: deliveryResult.success.fullCliOutput,
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
    ensureCurrent(deps);
    const { chatroomId, taskId, agentConfig } = task;
    const { role } = agentConfig;
    const { prompt, augmentationMode } = yield* loadNativeInjectionPrompt(task, deps);

    yield* Effect.tryPromise({
      try: () =>
        deps.lifecycleOutbox
          ? deps.lifecycleOutbox.enqueue(
              buildActivityLifecycleFact({
                chatroomId,
                role,
                action: NATIVE_TASK_INJECTED_ACTION,
                taskId,
              })
            )
          : Promise.reject(new Error('lifecycle outbox missing')),
      catch: (err) => err,
    });

    ensureCurrent(deps);
    yield* Effect.tryPromise({
      try: () =>
        deps.taskGateway.recordReceipt({
          sessionId: deps.sessionId,
          chatroomId,
          taskId,
          role,
          harnessSessionId,
        }),
      catch: (err) => err,
    });

    ensureCurrent(deps);
    yield* emitSessionAugmentationIfNeeded(
      task,
      deps,
      harnessSessionId,
      sessionAugmentationEmitted,
      augmentationMode
    );

    ensureCurrent(deps);
    yield* resumeHarnessWithPrompt(task, deps, prompt, harnessSessionId);
  });
}

export function runNativeInjectionEffect(
  task: AssignedTaskWithContent,
  initialHarnessSessionId: string | undefined,
  deps: NativeInjectorDeps
): Effect.Effect<void, unknown, never> {
  return Effect.gen(function* () {
    ensureCurrent(deps);
    yield* claimTaskForDelivery(task, deps);
    ensureCurrent(deps);
    const session = yield* resolveHarnessSessionForInject(task, deps, initialHarnessSessionId);
    yield* injectNativeTaskPrompt(
      task,
      deps,
      session.harnessSessionId,
      session.sessionAugmentationEmitted
    );
  });
}
