import type { Runtime, Context } from 'effect';

import type { NativeDeliveryService } from './native-delivery-service.js';
import type { NativeTaskDeliverySessionDeps } from './native-task-delivery-coordinator.js';
import type { AgentLifecycleFact } from '../../domain/entities/agent-lifecycle-fact.js';
import type {
  AgentKey,
  SerializedAgentOperations,
  SerializedAgentOperationOptions,
  SerializedAgentOperationContext,
} from '../../infrastructure/agent-process-manager/service/index.js';
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
  taskSnapshotState: MachineTaskSnapshotState;
  agentOperationalReadModel: AgentOperationalReadModel;
  nativeDelivery?: NativeDeliveryService | undefined;
  lifecycleOutbox: { enqueue: (fact: AgentLifecycleFact) => Promise<unknown> };
};

export type NativeDeliverySessionContext = NativeDeliverySessionRegistration;

let registered: NativeDeliverySessionContext | null = null;

export function registerNativeDeliverySession(ctx: NativeDeliverySessionRegistration): void {
  registered = ctx;
}

export function unregisterNativeDeliverySession(): void {
  registered = null;
}

export function getNativeDeliverySession(): NativeDeliverySessionContext | null {
  return registered;
}
