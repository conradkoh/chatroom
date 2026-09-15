// fallow-ignore-file code-duplication complexity
import type { ConvexClient } from 'convex/browser';
import { Effect } from 'effect';

import {
  DaemonAgentProcessManagerService,
  DaemonAgentProcessManagerCommandService,
  DaemonSessionService,
  AgentLifecycleOutboxService,
} from './daemon-services.js';
import type { AgentLifecycleFact } from '../domain/entities/agent-lifecycle-fact.js';
import {
  AgentWorkManager,
  type NativeDeliverySessionHandles,
} from '../services/service-interfaces.js';
import { createAgentTaskStateService } from '../services/service-interfaces.js';

export const startTaskInboxEffect = (
  wsClient: ConvexClient
): Effect.Effect<
  { stop: () => void; nativeDelivery: AgentWorkManager },
  never,
  | DaemonSessionService
  | DaemonAgentProcessManagerService
  | DaemonAgentProcessManagerCommandService
  | AgentLifecycleOutboxService
> =>
  Effect.gen(function* () {
    const session = yield* DaemonSessionService;
    const agentMgr = yield* DaemonAgentProcessManagerService;
    const commandService = yield* DaemonAgentProcessManagerCommandService;
    const lifecycleOutboxService = yield* AgentLifecycleOutboxService;
    const lifecycleOutbox = {
      enqueue: (fact: AgentLifecycleFact) =>
        Effect.runPromise(lifecycleOutboxService.enqueue(fact)),
    };
    const sessionDeps: NativeDeliverySessionHandles & { convexUrl: string } = {
      sessionId: session.sessionId,
      convexUrl: session.convexUrl,
      machineId: session.machineId,
      logEvent: session.logEvent,
      backend: {
        mutation: (fn, args) => session.backend.mutation(fn, args),
        query: (fn, args) => session.backend.query(fn, args),
      },
    };
    const agentTaskState = createAgentTaskStateService();
    const nativeDelivery = new AgentWorkManager({
      configurationService: session.agentConfigRegistry,
      agentMgr,
      runSerializedForAgent: commandService.runSerializedForAgent,
      acquireNativeDeliverySlot: commandService.acquireNativeDeliverySlot,
      sessionDeps,
      machineId: session.machineId,
      taskInboxState: session.taskService.taskInboxState,
      agentTaskState,
      lifecycleOutbox,
      taskService: session.taskService,
    });
    yield* Effect.tryPromise(() => session.taskService.startTaskInbox(wsClient)).pipe(
      Effect.catchAll((error) => {
        console.warn('[TaskService] task inbox bootstrap failed:', error);
        return Effect.void;
      })
    );

    return {
      nativeDelivery,
      stop() {
        session.taskService.stopTaskInbox();
        nativeDelivery.dispose();
        nativeDelivery.agentTaskState.clearAll();
      },
    };
  });
