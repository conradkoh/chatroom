import { Effect } from 'effect';

import type { AgentStopScopeCommandEvent } from '../../../domain/entities/command-event.js';
import { DaemonAgentProcessManagerService } from '../../daemon-services.js';

export const onStopScopeAgentEffect = (
  event: AgentStopScopeCommandEvent & { commandId?: string; _id?: string }
): Effect.Effect<void, never, DaemonAgentProcessManagerService> =>
  Effect.gen(function* () {
    const agentMgr = yield* DaemonAgentProcessManagerService;
    if (agentMgr.runInboxScopedStop) yield* agentMgr.runInboxScopedStop(event);
  });
