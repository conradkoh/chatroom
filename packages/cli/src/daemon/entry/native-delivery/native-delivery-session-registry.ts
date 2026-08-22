import type { Runtime, Context } from 'effect';

import type { NativeTaskDeliverySessionDeps } from './native-task-delivery-coordinator.js';
import { AgentOperationalReadModel } from '../../infrastructure/agent-operational/agent-operational-read-model.js';
import { MachineTaskSnapshotState } from '../../infrastructure/inbox/task-snapshot-state.js';
import type {
  DaemonAgentProcessManagerServiceShape,
  DaemonAgentProcessManagerService,
  DaemonSessionService,
} from '../daemon-services.js';

export type NativeDeliverySessionContext = {
  runtime: Runtime.Runtime<DaemonSessionService | DaemonAgentProcessManagerService>;
  effectContext: Context.Context<DaemonSessionService | DaemonAgentProcessManagerService>;
  agentMgr: DaemonAgentProcessManagerServiceShape;
  sessionDeps: NativeTaskDeliverySessionDeps;
  machineId: string;
  taskSnapshotState?: MachineTaskSnapshotState;
  agentOperationalReadModel?: AgentOperationalReadModel;
};

let registered: NativeDeliverySessionContext | null = null;

export function registerNativeDeliverySession(ctx: NativeDeliverySessionContext): void {
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
