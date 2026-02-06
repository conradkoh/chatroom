/**
 * Machine Infrastructure
 *
 * Exports for machine identity and configuration management.
 */

// Types
export type {
  AgentContext,
  AgentTool,
  LegacyMachineConfig,
  MachineConfig,
  MachineConfigFile,
  MachineEndpointConfig,
  MachineRegistrationInfo,
  ToolVersionInfo,
} from './types.js';
export { AGENT_TOOLS, AGENT_TOOL_COMMANDS, MACHINE_CONFIG_VERSION } from './types.js';

// Detection
export {
  detectAvailableTools,
  detectToolVersion,
  detectToolVersions,
  isToolAvailable,
} from './detection.js';

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
