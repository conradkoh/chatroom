import { spawnCommandProcess, type SpawnDeps } from '../../entry/handlers/process/spawner.js';

export type { SpawnDeps };

export interface ProcessSpawnPort {
  spawnCommandProcess: typeof spawnCommandProcess;
}

export function createProcessSpawnPort(): ProcessSpawnPort {
  return { spawnCommandProcess };
}
