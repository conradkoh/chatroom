import type { MachineAgentOperationalRow } from './agent-operational-read-model.js';
import { api } from '../../../api.js';
import type { NativeTaskDeliverySessionDeps } from '../../entry/native-delivery/native-task-delivery-coordinator.js';

export async function fetchMachineAgentOperationalStatus(
  sessionDeps: NativeTaskDeliverySessionDeps,
  machineId: string
): Promise<MachineAgentOperationalRow[]> {
  const result = await sessionDeps.backend.query(api.machines.listMachineAgentOperationalStatus, {
    sessionId: sessionDeps.sessionId,
    machineId,
  });
  return result as MachineAgentOperationalRow[];
}
