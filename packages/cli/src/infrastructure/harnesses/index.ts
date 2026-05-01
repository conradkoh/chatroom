/**
 * Barrel re-export for the infrastructure/harnesses module.
 *
 * Each sub-folder contains a constructor that returns a DirectHarnessSpawner
 * conforming to the domain interface.
 */

export { createOpencodeSdkHarness } from './opencode-sdk/index.js';
export type { CreateOpencodeSdkHarnessOptions } from './opencode-sdk/index.js';
