/**
 * agent-drivers — public API for the AgentToolDriver abstraction.
 *
 * Exposes all types, driver classes, and registry utilities.
 */

export type {
  AgentHarness,
  AgentCapabilities,
  AgentHandle,
  AgentStartOptions,
  AgentToolDriver,
  DriverRegistry,
} from './types.js';

export { ProcessAgentDriver } from './process-driver.js';
export type { ProcessDriverDeps } from './process-driver.js';

export { OpenCodeProcessDriver } from './opencode-process-driver.js';
export type { OpenCodeProcessDriverDeps } from './opencode-process-driver.js';

export { AgentDriverRegistry, createDefaultDriverRegistry } from './registry.js';
