import type { ConvexClient } from 'convex/browser';
import type { SessionId } from 'convex-helpers/server/sessions';

import type { MachineAgentOperationalRow } from './agent-operational-read-model.js';
import { api } from '../../../api.js';

export function subscribeMachineAgentOperationalStatus(
  client: ConvexClient,
  options: { sessionId: SessionId; machineId: string; signal?: AbortSignal },
  onRows: (rows: MachineAgentOperationalRow[]) => void
): () => void {
  return client.onUpdate(
    api.machines.subscribeMachineAgentOperationalStatus,
    { sessionId: options.sessionId, machineId: options.machineId },
    (result: unknown) => {
      if (Array.isArray(result)) onRows(result as MachineAgentOperationalRow[]);
    }
  );
}
