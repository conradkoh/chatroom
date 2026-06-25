import { NATIVE_TASK_INJECTED_ACTION } from '@workspace/backend/src/domain/entities/participant.js';
import { parseCompressContext } from '@workspace/backend/src/domain/handoff/parse-compress-context.js';
import type { AssignedTaskView } from '@workspace/backend/src/domain/usecase/machine/get-assigned-tasks.js';
import { Effect } from 'effect';

import {
  clearNativeTaskInjection,
  markNativeTaskInjected,
} from './native-injection-dedup-registry.js';
import type { NativeInjectionDedup } from './native-task-injector-logic.js';
import {
  buildNativeInjectionPrompt,
  shouldInjectNativeTask,
} from './native-task-injector-logic.js';
import { api } from '../../../api.js';
import { getErrorMessage } from '../../../utils/convex-error.js';

export interface NativeInjectorDeps {
  sessionId: string;
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
}

export function runNativeInjectionEffect(
  task: AssignedTaskView,
  deps: NativeInjectorDeps,
  dedup: NativeInjectionDedup
): Effect.Effect<void, unknown, never> {
  // fallow-ignore-next-line complexity
  return Effect.gen(function* () {
    if (!shouldInjectNativeTask(task, { alreadyInjectedTaskIds: dedup })) {
      return;
    }

    const { chatroomId, taskId, taskContent, agentConfig, status } = task;
    const { role } = agentConfig;

    if (!dedup.tryAcquire(taskId)) {
      return;
    }

    // Pending tasks must be claimed before delivery; acknowledged tasks are already owned.
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
        clearNativeTaskInjection(dedup, taskId);
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
      clearNativeTaskInjection(dedup, taskId);
      return yield* Effect.fail(deliveryResult.left);
    }

    const delivery = deliveryResult.right;

    const prompt = buildNativeInjectionPrompt({
      taskDeliveryOutput: delivery.fullCliOutput,
      compressMode: parseCompressContext(taskContent),
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
    }).pipe(Effect.tapError(() => Effect.sync(() => clearNativeTaskInjection(dedup, taskId))));

    const resumeResult = yield* Effect.tryPromise({
      try: () => deps.agentMgr.resumeTurnForSlot({ chatroomId, role, prompt }),
      catch: (err) => err,
    }).pipe(Effect.either);

    if (resumeResult._tag === 'Left') {
      clearNativeTaskInjection(dedup, taskId);
      console.warn(
        `[NativeTaskInjector] resumeTurn failed for ${role}@${chatroomId}: ${getErrorMessage(resumeResult.left)}`
      );
      return;
    }

    markNativeTaskInjected(dedup, taskId, { chatroomId, role });
  });
}
