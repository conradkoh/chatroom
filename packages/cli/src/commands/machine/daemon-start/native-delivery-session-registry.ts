import type { Runtime, Context } from 'effect';

import type {
  DaemonAgentProcessManagerServiceShape,
  DaemonAgentProcessManagerService,
  DaemonSessionService,
} from './daemon-services.js';
import type { NativeTaskDeliverySessionDeps } from './native-task-delivery-coordinator.js';

export type NativeDeliverySessionContext = {
  runtime: Runtime.Runtime<DaemonSessionService | DaemonAgentProcessManagerService>;
  effectContext: Context.Context<DaemonSessionService | DaemonAgentProcessManagerService>;
  agentMgr: DaemonAgentProcessManagerServiceShape;
  sessionDeps: NativeTaskDeliverySessionDeps;
  machineId: string;
};

let registered: NativeDeliverySessionContext | null = null;

export function registerNativeDeliverySession(ctx: NativeDeliverySessionContext): void {
  registered = ctx;
}

export function unregisterNativeDeliverySession(): void {
  registered = null;
}

export function getNativeDeliverySession(): NativeDeliverySessionContext | null {
  return registered;
}
