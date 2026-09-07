// fallow-ignore-file unused-file
import { vi } from 'vitest';

import {
  AgentOperationalReadModel,
  type MachineAgentOperationalRow,
} from './agent-operational-read-model.js';
import {
  registerNativeDeliverySession,
  type NativeDeliverySessionRegistration,
} from '../../entry/native-delivery/native-delivery-session-registry.js';
import type { NativeInjectorDeps } from '../../entry/native-delivery/native-task-injector.js';
import { MachineTaskSnapshotState } from '../inbox/task-snapshot-state.js';

export function mockLifecycleOutbox() {
  return { enqueue: vi.fn().mockResolvedValue({ success: true }) };
}

export function operationalRow(
  chatroomId: string,
  role: string,
  operationalState: MachineAgentOperationalRow['operationalState'] = 'running',
  stopState?: MachineAgentOperationalRow['stopState']
): MachineAgentOperationalRow {
  return {
    chatroomId,
    role,
    operationalState,
    isAlive: operationalState !== 'stopped',
    isRunning: operationalState === 'running',
    daemonConnected: true,
    revisionKey: `test:${chatroomId}:${role}:${operationalState}`,
    stopState,
  };
}
export function createOperationalReadModel(
  rows: MachineAgentOperationalRow[]
): AgentOperationalReadModel {
  const model = new AgentOperationalReadModel();
  if (rows.length) model.replace(rows);
  return model;
}
export function registerTestNativeDeliverySession(
  ctx: Omit<
    NativeDeliverySessionRegistration,
    'agentOperationalReadModel' | 'taskSnapshotState' | 'runSerializedForAgent'
  > & {
    operationalRows?: MachineAgentOperationalRow[] | undefined;
    taskSnapshotState?: MachineTaskSnapshotState | undefined;
    runSerializedForAgent?: NativeInjectorDeps['runSerializedForAgent'];
  }
): void {
  registerNativeDeliverySession({
    ...ctx,
    taskSnapshotState: ctx.taskSnapshotState ?? new MachineTaskSnapshotState(),
    agentOperationalReadModel: createOperationalReadModel(ctx.operationalRows ?? []),
    lifecycleOutbox: ctx.lifecycleOutbox ?? mockLifecycleOutbox(),
    runSerializedForAgent:
      ctx.runSerializedForAgent ??
      (async (_key, _options, operation) =>
        operation(
          {
            startAgent: async () => ({ success: true }),
            stopAgent: async () => ({ success: true }),
          },
          { signal: new AbortController().signal }
        )),
  });
}
