import type { Runtime, Context } from 'effect';

import type { NativeTaskDeliverySessionDeps } from './native-task-delivery-coordinator.js';
import type { AgentLifecycleFact } from '../../domain/entities/agent-lifecycle-fact.js';
import { AgentOperationalReadModel } from '../../infrastructure/agent-operational/agent-operational-read-model.js';
import type {
  AgentKey,
  SerializedAgentOperations,
  SerializedAgentOperationOptions,
  SerializedAgentOperationContext,
} from '../../infrastructure/agent-process-manager/service/index.js';
import { MachineTaskSnapshotState } from '../../infrastructure/inbox/task-snapshot-state.js';
import type {
  DaemonAgentProcessManagerServiceShape,
  DaemonAgentProcessManagerService,
  DaemonSessionService,
} from '../daemon-services.js';

export type NativeDeliverySessionRegistration = {
  runtime: Runtime.Runtime<DaemonSessionService | DaemonAgentProcessManagerService>;
  effectContext: Context.Context<DaemonSessionService | DaemonAgentProcessManagerService>;
  agentMgr: DaemonAgentProcessManagerServiceShape;
  runSerializedForAgent: <T>(
    key: AgentKey,
    options: SerializedAgentOperationOptions,
    operation: (
      ops: SerializedAgentOperations,
      context: SerializedAgentOperationContext
    ) => Promise<T>
  ) => Promise<T>;
  sessionDeps: NativeTaskDeliverySessionDeps;
  machineId: string;
  taskSnapshotState?: MachineTaskSnapshotState | undefined;
  agentOperationalReadModel?: AgentOperationalReadModel | undefined;
  lifecycleOutbox?: { enqueue: (fact: AgentLifecycleFact) => Promise<unknown> } | undefined;
};

export type NativeDeliverySessionContext = Omit<
  NativeDeliverySessionRegistration,
  'taskSnapshotState' | 'agentOperationalReadModel'
> & {
  taskSnapshotState: MachineTaskSnapshotState;
  agentOperationalReadModel: AgentOperationalReadModel;
};

let registered: NativeDeliverySessionContext | null = null;

export function registerNativeDeliverySession(ctx: NativeDeliverySessionRegistration): void {
  registered = {
    ...ctx,
    taskSnapshotState: ctx.taskSnapshotState ?? new MachineTaskSnapshotState(),
    agentOperationalReadModel: ctx.agentOperationalReadModel ?? new AgentOperationalReadModel(),
  };
}

export function unregisterNativeDeliverySession(): void {
  registered = null;
}

export function getNativeDeliverySession(): NativeDeliverySessionContext | null {
  return registered;
}
