import { Effect } from 'effect';
import { DaemonAgentProcessManagerService } from '../../daemon-services.js';
import type { AgentStopScopeCommandEvent } from '../../../domain/entities/command-event.js';

export const onStopScopeAgentEffect = (event: AgentStopScopeCommandEvent & { commandId?: string; _id?: string }): Effect.Effect<void, never, DaemonAgentProcessManagerService> =>
  Effect.gen(function* () {
    if (Date.now() > event.deadline) return;
    const agentMgr = yield* DaemonAgentProcessManagerService;
    if (agentMgr.runInboxScopedStop) yield* agentMgr.runInboxScopedStop(event);
  });
