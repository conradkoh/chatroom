import { Effect } from 'effect';

import type { AgentStopScopeCommandEvent } from '../../../domain/entities/command-event.js';
import { DaemonAgentProcessManagerService } from '../../daemon-services.js';

export const onStopScopeAgentEffect = (
  event: AgentStopScopeCommandEvent & { commandId?: string | undefined; _id?: string | undefined }
): Effect.Effect<void, never, DaemonAgentProcessManagerService> =>
  Effect.gen(function* () {
    const agentMgr = yield* DaemonAgentProcessManagerService;
    const stop = agentMgr.runInboxScopedStop;
    if (stop) yield* stop(event);
  });
