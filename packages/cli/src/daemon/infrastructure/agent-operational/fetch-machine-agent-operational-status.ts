import type { MachineAgentOperationalRow } from './operational-signal-feeds.js';
import { api } from '../../../api.js';
import type { NativeTaskDeliverySessionDeps } from '../../services/service-interfaces.js';

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
