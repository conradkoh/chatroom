import { AGENT_LIFECYCLE_OPERATION_TIMEOUT_MS } from '@workspace/backend/config/reliability.js';

import { abortEnhancerSpawnsForChatroom } from './enhancer/enhancer-spawn-registry.js';
import { runRoleScopedStop } from '../services/agent-process-service/index.js';
import type {
  AgentProcessManager,
  AgentProcessManagerService,
} from '../services/service-interfaces.js';

export async function executeChatroomStopCommand(args: {
  apm: AgentProcessManager;
  chatroomId: string;
  commandId: string;
  role?: string | undefined;
  finalizeChatroom?: boolean | undefined;
  runSerializedForAgent: AgentProcessManagerService['runSerializedForAgent'];
}): Promise<void> {
  if (args.role) args.apm.markStopIntent(args.chatroomId, args.role, 'user.stop');
  else {
    args.apm.markChatroomStopIntent(args.chatroomId, 'user.stop');
    await abortEnhancerSpawnsForChatroom(args.chatroomId);
  }

  const confirmedDeps = args.apm.getConfirmedStopAdapterDeps();
  const targets = await args.apm.discoverStopTargets(args.chatroomId);
  const roles = [
    ...new Set(
      targets
        .filter((target) => !args.role || target.role.toLowerCase() === args.role.toLowerCase())
        .map((target) => target.role.toLowerCase())
    ),
  ];

  const results = await Promise.allSettled(
    roles.map((role) =>
      args.runSerializedForAgent(
        { chatroomId: args.chatroomId, role },
        { timeoutMs: AGENT_LIFECYCLE_OPERATION_TIMEOUT_MS },
        async (_ops, context) => {
          if (context.signal.aborted) throw context.signal.reason;
          await runRoleScopedStop({
            apm: args.apm,
            confirmedDeps,
            chatroomId: args.chatroomId,
            role,
            reason: 'user.stop',
          });
        }
      )
    )
  );
  for (const result of results)
    if (result.status === 'rejected')
      console.warn('[daemon] chatroom stop attempt failed', result.reason);

  await confirmedDeps.lifecycleOutbox.enqueue({
    kind: 'chatroom_shutdown_complete',
    chatroomId: args.chatroomId,
    commandId: args.commandId,
    ...(args.finalizeChatroom === undefined ? {} : { finalizeChatroom: args.finalizeChatroom }),
    revisionKey: `shutdown:${args.commandId}`,
    emittedAt: Date.now(),
  });
}
