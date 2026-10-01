import { AGENT_LIFECYCLE_OPERATION_TIMEOUT_MS } from '@workspace/backend/config/reliability.js';

// fallow-ignore-file complexity
import { runRoleScopedStop } from '../services/agent-process-service/index.js';
import type {
  AgentProcessManager,
  AgentProcessManagerService,
  AgentWorkManager,
  TaskService,
} from '../services/service-interfaces.js';

export async function executeChatroomStopCommand(args: {
  apm: AgentProcessManager;
  chatroomId: string;
  commandId: string;
  role?: string | undefined;
  workingDir?: string | undefined;
  finalizeChatroom?: boolean | undefined;
  runSerializedForAgent: AgentProcessManagerService['runSerializedForAgent'];
  nativeDelivery: Pick<AgentWorkManager, 'prepareRoleRecovery' | 'recoverStoppedRole'>;
  taskService: Pick<TaskService, 'listMachineTaskRolesForChatroom'>;
}): Promise<void> {
  if (args.role)
    args.apm.markStopIntent(args.chatroomId, args.role, 'user.stop', undefined, args.workingDir);
  else if (!args.workingDir) {
    args.apm.markChatroomStopIntent(args.chatroomId, 'user.stop');
  }

  const confirmedDeps = args.apm.getConfirmedStopAdapterDeps();
  const targets = await args.apm.discoverStopTargets(args.chatroomId);
  const roles = new Set(
    targets
      .filter(
        (target) =>
          target.chatroomId === args.chatroomId &&
          (!args.role || target.role.toLowerCase() === args.role.toLowerCase()) &&
          (!args.workingDir || target.workingDir === args.workingDir)
      )
      .map((target) => target.role.toLowerCase())
  );
  if (args.role) roles.add(args.role.toLowerCase());
  if (!args.role && !args.workingDir) {
    for (const role of await args.taskService.listMachineTaskRolesForChatroom(args.chatroomId))
      roles.add(role.toLowerCase());
  }

  const results = await Promise.allSettled(
    [...roles].map((role) =>
      args.runSerializedForAgent(
        { chatroomId: args.chatroomId, role, workingDir: args.workingDir },
        { timeoutMs: AGENT_LIFECYCLE_OPERATION_TIMEOUT_MS },
        async (_ops, context) => {
          if (context.signal.aborted) throw context.signal.reason;
          await args.nativeDelivery.prepareRoleRecovery({ chatroomId: args.chatroomId, role });
          const result = await runRoleScopedStop({
            apm: args.apm,
            confirmedDeps,
            chatroomId: args.chatroomId,
            role,
            reason: 'user.stop',
            workingDir: args.workingDir,
          });
          if (result.failures.length > 0)
            throw new AggregateError(
              result.failures.map((failure) => failure.error),
              `agent stop failed room=${args.chatroomId} role=${role}`
            );

          if (args.workingDir) {
            // Re-discover after stopping so targets stopped by this operation are
            // not mistaken for live processes outside the requested directory.
            const remainingTargets = await args.apm.discoverStopTargets(args.chatroomId);
            const liveOutsideScope = remainingTargets.some(
              (target) =>
                target.chatroomId === args.chatroomId &&
                target.role.toLowerCase() === role &&
                target.workingDir !== args.workingDir
            );
            if (liveOutsideScope)
              throw new Error(
                `cannot recover role with a live process outside working directory room=${args.chatroomId} role=${role}`
              );
          }

          await args.nativeDelivery.recoverStoppedRole({
            chatroomId: args.chatroomId,
            role,
            mode: 'explicit',
          });
        }
      )
    )
  );
  const failures = results.flatMap((result) =>
    result.status === 'rejected' ? [result.reason] : []
  );
  for (const error of failures) console.warn('[daemon] chatroom stop attempt failed', error);
  if (failures.length > 0)
    throw new AggregateError(failures, `chatroom stop failed room=${args.chatroomId}`);

  // Persist the backend acknowledgement only after every process stop and role
  // recovery has succeeded. Delivery can finish after reconnect.
  await confirmedDeps.lifecycleOutbox.enqueue({
    kind: 'chatroom_shutdown_complete',
    chatroomId: args.chatroomId,
    commandId: args.commandId,
    ...(args.finalizeChatroom === undefined ? {} : { finalizeChatroom: args.finalizeChatroom }),
    revisionKey: `shutdown:${args.commandId}`,
    emittedAt: Date.now(),
  });
}
