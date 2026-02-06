/**
 * Agent Driver Registry
 *
 * Maps AgentTool identifiers to their driver instances.
 * The daemon resolves drivers from this registry to dispatch commands.
 *
 * Usage:
 *   import { getDriverRegistry } from './registry.js';
 *   const registry = getDriverRegistry();
 *   const driver = registry.get('opencode');
 *   const result = await driver.start(options);
 */

import { ClaudeDriver } from './claude-driver.js';
import { CursorDriver } from './cursor-driver.js';
import { OpenCodeProcessDriver } from './opencode-process-driver.js';
import type { AgentCapabilities, AgentToolDriver, DriverRegistry } from './types.js';
import type { AgentTool } from '../machine/types.js';

// ─── Default Registry Implementation ─────────────────────────────────────────

class DefaultDriverRegistry implements DriverRegistry {
  private readonly drivers: Map<AgentTool, AgentToolDriver>;

  constructor(drivers: AgentToolDriver[]) {
    this.drivers = new Map();
    for (const driver of drivers) {
      this.drivers.set(driver.tool, driver);
    }
  }

  get(tool: AgentTool): AgentToolDriver {
    const driver = this.drivers.get(tool);
    if (!driver) {
      throw new Error(`No driver registered for tool: ${tool}`);
    }
    return driver;
  }

  all(): AgentToolDriver[] {
    return Array.from(this.drivers.values());
  }

  capabilities(tool: AgentTool): AgentCapabilities {
    return this.get(tool).capabilities;
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
    registryInstance = new DefaultDriverRegistry([
      new OpenCodeProcessDriver(),
      new ClaudeDriver(),
      new CursorDriver(),
    ]);
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
