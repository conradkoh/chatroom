import type { BackendOps, SessionOps } from '../../infrastructure/deps/index.js';
import type { MachineConfig } from '../../infrastructure/machine/types.js';

export interface AgentDeps {
  backend: Pick<BackendOps, 'mutation' | 'query'>;
  session: Pick<SessionOps, 'getSessionId'>;
  machine: {
    getMachineId: () => Promise<string | null>;
    loadMachineConfig: () => Promise<MachineConfig | null>;
  };
}
