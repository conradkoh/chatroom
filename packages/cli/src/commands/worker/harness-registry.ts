/**
 * Default harness factory registry for the worker commands.
 * Returns a DirectHarnessSpawner for the requested harness name.
 */

import type { DirectHarnessSpawner } from '../../domain/direct-harness/index.js';
import { createOpencodeSdkHarness } from '../../infrastructure/harnesses/opencode-sdk/index.js';

/**
 * Instantiates a DirectHarnessSpawner for the requested harness name.
 * Throws with a helpful error when the name is unknown.
 */
export function defaultHarnessFactory(name: string): DirectHarnessSpawner {
  switch (name) {
    case 'opencode-sdk':
      return createOpencodeSdkHarness();
    default:
      throw new Error(`Unknown harness: "${name}". Available harnesses: opencode-sdk`);
  }
}
