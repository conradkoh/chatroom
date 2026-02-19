/**
 * Machine Infrastructure
 *
 * Public API for machine identity and configuration management.
 * Only exports symbols that are used by consumers outside this module.
 */

// Types
export type { AgentHarness, HarnessVersionInfo } from './types.js';
export { AGENT_HARNESS_COMMANDS } from './types.js';

// Storage (static machine config)
export {
  ensureMachineRegistered,
  getMachineId,
  loadMachineConfig,
} from './storage.js';

// Daemon state (runtime PID tracking — separate from machine.json)
export {
  clearAgentPid,
  listAgentEntries,
  persistAgentPid,
} from './daemon-state.js';

// Intentional stop tracking (in-memory, volatile)
export {
  markIntentionalStop,
  consumeIntentionalStop,
  clearIntentionalStop,
  isMarkedForIntentionalStop,
  resetIntentionalStops,
} from './intentional-stops.js';
