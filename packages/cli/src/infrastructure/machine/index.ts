/**
 * Machine Infrastructure
 *
 * Exports for machine identity and configuration management.
 */

// Types
export type { AgentContext, AgentTool, MachineConfig, MachineRegistrationInfo } from './types.js';
export { AGENT_TOOLS, AGENT_TOOL_COMMANDS } from './types.js';

// Detection
export { detectAvailableTools, isToolAvailable } from './detection.js';

// Storage
export {
  ensureMachineRegistered,
  getAgentContext,
  getMachineConfigPath,
  getMachineId,
  listChatroomAgents,
  loadMachineConfig,
  saveMachineConfig,
  updateAgentContext,
} from './storage.js';
