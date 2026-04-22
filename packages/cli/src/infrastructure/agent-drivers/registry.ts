/**
 * AgentDriverRegistry — resolves AgentToolDriver instances by AgentHarness key.
 *
 * This is the central lookup for the daemon to find a driver for a given harness.
 * Currently only the opencode harness has a driver; others remain as RemoteAgentService
 * and will be migrated in subsequent phases.
 */

import { OpenCodeProcessDriver } from './opencode-process-driver.js';
import type { AgentCapabilities, AgentHarness, AgentToolDriver, DriverRegistry } from './types.js';

// ─── Registry Implementation ──────────────────────────────────────────────────

export class AgentDriverRegistry implements DriverRegistry {
  private readonly drivers: Map<AgentHarness, AgentToolDriver>;

  constructor(drivers: AgentToolDriver[]) {
    this.drivers = new Map(drivers.map((d) => [d.harness, d]));
  }

  get(harness: AgentHarness): AgentToolDriver {
    const driver = this.drivers.get(harness);
    if (!driver) {
      throw new Error(`No driver registered for harness: ${harness}`);
    }
    return driver;
  }

  all(): AgentToolDriver[] {
    return Array.from(this.drivers.values());
  }

  capabilities(harness: AgentHarness): AgentCapabilities {
    return this.get(harness).capabilities;
  }
}

// ─── Default Registry ─────────────────────────────────────────────────────────

/** Creates the default registry with all built-in drivers. */
export function createDefaultDriverRegistry(): AgentDriverRegistry {
  return new AgentDriverRegistry([new OpenCodeProcessDriver()]);
}
