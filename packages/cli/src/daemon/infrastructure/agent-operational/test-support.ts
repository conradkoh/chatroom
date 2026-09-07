// fallow-ignore-file unused-file
import type { MachineAgentOperationalRow } from './agent-operational-read-model.js';

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
