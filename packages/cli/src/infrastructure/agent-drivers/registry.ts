/**
 * Agent Driver Registry
 *
 * Maps AgentHarness identifiers to their driver instances.
 * The daemon resolves drivers from this registry to dispatch commands.
 *
 * Usage:
 *   import { getDriverRegistry } from './registry.js';
 *   const registry = getDriverRegistry();
 *   const driver = registry.get('opencode');
 *   const result = await driver.start(options);
 */

import { OpenCodeProcessDriver } from './opencode-process-driver.js';
import type { AgentCapabilities, AgentHarnessDriver, DriverRegistry } from './types.js';
import type { AgentHarness } from '../machine/types.js';

// ─── Default Registry Implementation ─────────────────────────────────────────

class DefaultDriverRegistry implements DriverRegistry {
  private readonly drivers: Map<AgentHarness, AgentHarnessDriver>;

  constructor(drivers: AgentHarnessDriver[]) {
    this.drivers = new Map();
    for (const driver of drivers) {
      this.drivers.set(driver.harness, driver);
    }
  }

  get(harness: AgentHarness): AgentHarnessDriver {
    const driver = this.drivers.get(harness);
    if (!driver) {
      throw new Error(`No driver registered for harness: ${harness}`);
    }
    return driver;
  }

  all(): AgentHarnessDriver[] {
    return Array.from(this.drivers.values());
  }

  capabilities(harness: AgentHarness): AgentCapabilities {
    return this.get(harness).capabilities;
  }
}

// ─── Singleton ───────────────────────────────────────────────────────────────

let registryInstance: DriverRegistry | null = null;

/**
 * Get the singleton driver registry.
 * Creates and initializes it on first call.
 *
 * The registry is populated with all known process-based drivers.
 * In Phase 4, the OpenCode process driver will be swapped for the SDK driver.
 */
export function getDriverRegistry(): DriverRegistry {
  if (!registryInstance) {
    registryInstance = new DefaultDriverRegistry([new OpenCodeProcessDriver()]);
  }
  return registryInstance;
}

/**
 * Reset the registry (for testing).
 * @internal
 */
export function _resetRegistryForTesting(): void {
  registryInstance = null;
}
