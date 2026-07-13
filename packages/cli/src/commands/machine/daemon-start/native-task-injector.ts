import { NATIVE_TASK_INJECTED_ACTION } from '@workspace/backend/src/domain/entities/participant.js';
import { roleSupportsSessionAugmentation } from '@workspace/backend/src/domain/entities/team-agent-settings.js';
import {
  resolveSessionAugmentationForRole,
  sessionAugmentationNewSessionStarted,
} from '@workspace/backend/src/domain/handoff/parse-session-augmentation.js';
import type { AssignedTaskView } from '@workspace/backend/src/domain/usecase/machine/assigned-tasks-types.js';
import { Effect } from 'effect';

import { buildNativeInjectionPrompt } from './native-task-injector-logic.js';
import { api } from '../../../api.js';
import { getErrorMessage } from '../../../utils/convex-error.js';

export interface NativeInjectorDeps {
  sessionId: string;
  machineId: string;
  backend: {
    mutation: (fn: unknown, args: Record<string, unknown>) => Promise<unknown>;
    query: (fn: unknown, args: Record<string, unknown>) => Promise<unknown>;
  };
  agentMgr: {
    resumeTurnForSlot: (args: {
      chatroomId: string;
      role: string;
      prompt: string;
    }) => Promise<void>;
  };
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
    await deps.backend.mutation(api.machines.emitTaskDeliveryFailed, {
      sessionId: deps.sessionId,
      machineId: deps.machineId,
      chatroomId: args.chatroomId,
      role: args.role,
      taskId: args.taskId,
      error: args.error,
    });
  } catch {
    // Non-critical observability
  }
}

export function runNativeInjectionEffect(
  task: AssignedTaskView,
  harnessSessionId: string,
  deps: NativeInjectorDeps
): Effect.Effect<void, unknown, never> {
  return Effect.gen(function* () {
    const { chatroomId, taskId, taskContent, agentConfig, status } = task;
    const { role } = agentConfig;

    if (status === 'pending') {
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
        yield* Effect.tryPromise({
          try: () =>
            emitTaskDeliveryFailed(deps, {
              chatroomId,
              role,
              taskId: taskId as string,
              error: getErrorMessage(claimResult.left),
            }),
          catch: () => undefined,
        }).pipe(Effect.catchAll(() => Effect.void));
        return yield* Effect.fail(claimResult.left);
      }
    }

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
      yield* Effect.tryPromise({
        try: () =>
          emitTaskDeliveryFailed(deps, {
            chatroomId,
            role,
            taskId: taskId as string,
            error: getErrorMessage(deliveryResult.left),
          }),
        catch: () => undefined,
      }).pipe(Effect.catchAll(() => Effect.void));
      return yield* Effect.fail(deliveryResult.left);
    }

    const delivery = deliveryResult.right;
    const augmentationMode = resolveSessionAugmentationForRole(taskContent, role);
    const prompt = buildNativeInjectionPrompt({
      taskDeliveryOutput: delivery.fullCliOutput,
      augmentationMode,
    });

    yield* Effect.tryPromise({
      try: () =>
        deps.backend.mutation(api.participants.join, {
          sessionId: deps.sessionId,
          chatroomId,
          role,
          action: NATIVE_TASK_INJECTED_ACTION,
          taskId,
        }),
      catch: (err) => err,
    });

    if (roleSupportsSessionAugmentation(role)) {
      yield* Effect.tryPromise({
        try: () =>
          deps.backend.mutation(api.machines.emitSessionAugmented, {
            sessionId: deps.sessionId,
            machineId: deps.machineId,
            chatroomId,
            role,
            taskId,
            mode: augmentationMode,
            newSessionStarted: sessionAugmentationNewSessionStarted(augmentationMode),
            harnessSessionId,
          }),
        catch: (err) => err,
      }).pipe(Effect.catchAll(() => Effect.void));
    }

    const resumeResult = yield* Effect.tryPromise({
      try: () => deps.agentMgr.resumeTurnForSlot({ chatroomId, role, prompt }),
      catch: (err) => err,
    }).pipe(Effect.either);

    if (resumeResult._tag === 'Left') {
      const error = getErrorMessage(resumeResult.left);
      console.warn(`[NativeTaskInjector] resumeTurn failed for ${role}@${chatroomId}: ${error}`);
      yield* Effect.tryPromise({
        try: () =>
          emitTaskDeliveryFailed(deps, {
            chatroomId,
            role,
            taskId: taskId as string,
            error,
          }),
        catch: () => undefined,
      }).pipe(Effect.catchAll(() => Effect.void));
      return;
    }

    yield* Effect.tryPromise({
      try: () =>
        deps.backend.mutation(api.machines.emitTaskDelivered, {
          sessionId: deps.sessionId,
          machineId: deps.machineId,
          chatroomId,
          role,
          taskId,
        }),
      catch: (err) => err,
    }).pipe(Effect.catchAll(() => Effect.void));

    deps.onTaskDelivered?.({ chatroomId, role, taskId: taskId as string });
  });
}
