/**
 * State Recovery Handler — recovers agent state on daemon restart.
 * Delegates to v2 recoverAgentState use case via agent-control bridge.
 */

import { Effect } from 'effect';

import {
  DaemonAgentProcessManagerService,
  DaemonSessionService,
} from '../../../commands/machine/daemon-start/daemon-services.js';
import { recoverAgentState } from '../../domain/usecase/recover-agent-state.js';
import { createRecoverAgentStateDeps } from '../bridge/agent-control-bridge.js';

export const recoverAgentStateEffect: Effect.Effect<
  void,
  never,
  DaemonSessionService | DaemonAgentProcessManagerService
> = Effect.gen(function* () {
  const session = yield* DaemonSessionService;
  const agentMgr = yield* DaemonAgentProcessManagerService;

  yield* Effect.promise(() => recoverAgentState(createRecoverAgentStateDeps(agentMgr, session)));
});
