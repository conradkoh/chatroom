import {
  spawnCommandProcess,
  type SpawnDeps,
} from '../../../commands/machine/daemon-start/handlers/process/spawner.js';

export type { SpawnDeps };

export interface ProcessSpawnPort {
  spawnCommandProcess: typeof spawnCommandProcess;
}

export function createProcessSpawnPort(): ProcessSpawnPort {
  return { spawnCommandProcess };
}
