/**
 * Barrel re-export for the infrastructure/harnesses module.
 *
 * Each sub-folder contains adapters conforming to DirectHarnessSpawner.
 */

export { createOpencodeSdkHarness, createOpencodeSdkHarnessProcess } from './opencode-sdk/index.js';
export type { CreateOpencodeSdkHarnessOptions, SpawnOpencodeSdkProcessOptions } from './opencode-sdk/index.js';
