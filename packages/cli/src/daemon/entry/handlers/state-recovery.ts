/**
 * State Recovery Handler — recovers agent state on daemon restart.
 * Delegates to v2 recoverAgentState use case via agent-control bridge.
 */

import { Effect } from 'effect';

import { recoverAgentState } from '../../domain/usecase/recover-agent-state.js';
import { createRecoverAgentStateDeps } from '../bridge/agent-control-bridge.js';
import {
  DaemonAgentProcessManagerCommandService,
  DaemonSessionService,
} from '../daemon-services.js';

export const recoverAgentStateEffect: Effect.Effect<
  void,
  never,
  DaemonSessionService | DaemonAgentProcessManagerCommandService
> = Effect.gen(function* () {
  const session = yield* DaemonSessionService;
  const processManagerService = yield* DaemonAgentProcessManagerCommandService;

  yield* Effect.promise(() =>
    recoverAgentState(createRecoverAgentStateDeps(processManagerService, session))
  );
});
