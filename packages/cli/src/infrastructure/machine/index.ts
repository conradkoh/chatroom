/**
 * Machine Infrastructure
 *
 * Public API for machine identity and configuration management.
 * Only exports symbols that are used by consumers outside this module.
 */

// Types
export type { AgentContext, AgentTool, ToolVersionInfo } from './types.js';
export { AGENT_TOOL_COMMANDS } from './types.js';

// Storage
export {
  ensureMachineRegistered,
  getAgentContext,
  getMachineId,
  loadMachineConfig,
  updateAgentContext,
} from './storage.js';
