/**
 * Agent Drivers — Public API
 *
 * Re-exports the types, registry, and driver classes that consumers
 * outside this module need.
 */

// Types (contracts)
export type {
  AgentCapabilities,
  AgentHandle,
  AgentStartOptions,
  AgentToolDriver,
  DriverRegistry,
  DriverStartResult,
} from './types.js';

// Registry
export { getDriverRegistry } from './registry.js';

// Base class (for extending with new drivers)
export { ProcessDriver } from './process-driver.js';

// Utility functions (for custom drivers that need temp file or prompt helpers)
export { buildCombinedPrompt, writeTempPromptFile, scheduleCleanup } from './process-driver.js';

// Concrete drivers (consumers rarely need these directly, but exported for testing)
export { ClaudeDriver } from './claude-driver.js';
export { OpenCodeProcessDriver } from './opencode-process-driver.js';
