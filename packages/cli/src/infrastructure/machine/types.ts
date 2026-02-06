/**
 * Machine Identity Types
 *
 * Type definitions for machine configuration and agent management.
 */

/**
 * Supported AI agent tools that can be spawned
 */
export type AgentTool = 'opencode' | 'claude' | 'cursor';

/**
 * All supported agent tools
 */
export const AGENT_TOOLS: AgentTool[] = ['opencode', 'claude', 'cursor'];

/**
 * Command names for each agent tool (used for detection)
 */
export const AGENT_TOOL_COMMANDS: Record<AgentTool, string> = {
  opencode: 'opencode',
  claude: 'claude',
  cursor: 'agent', // Cursor CLI uses 'agent' command
};

/**
 * Detected tool version info
 */
export interface ToolVersionInfo {
  /** Full version string (e.g. "1.2.3") */
  version: string;
  /** Major version number for compatibility gating */
  major: number;
}

/**
 * Available AI models per agent tool.
 *
 * Each tool supports a different set of models. The first model
 * in each array is the default for that tool.
 */
export const TOOL_MODELS: Record<AgentTool, string[]> = {
  opencode: [
    'claude-sonnet-4-20250514',
    'claude-opus-4-20250514',
    'o3',
    'o4-mini',
    'gemini-2.5-pro',
  ],
  claude: ['claude-sonnet-4-20250514', 'claude-opus-4-20250514'],
  cursor: [],
};

/**
 * Display names for AI models (short labels for UI).
 */
export const MODEL_DISPLAY_NAMES: Record<string, string> = {
  'claude-sonnet-4-20250514': 'Sonnet 4',
  'claude-opus-4-20250514': 'Opus 4',
  o3: 'o3',
  'o4-mini': 'o4-mini',
  'gemini-2.5-pro': 'Gemini 2.5 Pro',
};

/**
 * Per-chatroom, per-role agent context
 */
export interface AgentContext {
  /** Which tool was used for this role */
  agentType: AgentTool;
  /** Working directory when agent was started */
  workingDir: string;
  /** Last time this agent was started (ISO string) */
  lastStartedAt: string;
}

/**
 * Per-endpoint machine entry in the versioned config file.
 * Each Convex URL endpoint gets its own machine identity.
 */
export interface MachineEndpointConfig {
  /** UUID generated once per machine per endpoint */
  machineId: string;
  /** Machine hostname */
  hostname: string;
  /** Operating system (darwin, linux, win32) */
  os: string;
  /** When machine was first registered (ISO string) */
  registeredAt: string;
  /** Last time config was synced (ISO string) */
  lastSyncedAt: string;
  /** Agent tools detected as available */
  availableTools: AgentTool[];
  /** Detected tool versions (keyed by tool name) */
  toolVersions: Partial<Record<AgentTool, ToolVersionInfo>>;
  /** Per-chatroom agent configurations */
  chatroomAgents: Record<string, Record<string, AgentContext>>;
}

/**
 * Current config file version
 */
export const MACHINE_CONFIG_VERSION = '1';

/**
 * Versioned machine config file stored in ~/.chatroom/machine.json
 * Indexed by Convex URL so a single machine can work with multiple endpoints.
 */
export interface MachineConfigFile {
  /** Config format version for migration support */
  version: string;
  /** Per-endpoint machine configurations, keyed by Convex URL */
  machines: Record<string, MachineEndpointConfig>;
}

/**
 * Legacy (pre-versioned) machine config format for migration.
 * This is the old flat format that was used before URL-indexing.
 */
export interface LegacyMachineConfig {
  machineId: string;
  hostname: string;
  os: string;
  registeredAt: string;
  lastSyncedAt: string;
  availableTools: AgentTool[];
  chatroomAgents: Record<string, Record<string, AgentContext>>;
}

/**
 * MachineConfig is now an alias for MachineEndpointConfig (for the active endpoint).
 * Callers that used loadMachineConfig() continue to get a single endpoint config.
 */
export type MachineConfig = MachineEndpointConfig;

/**
 * Minimal machine info for registration
 */
export interface MachineRegistrationInfo {
  machineId: string;
  hostname: string;
  os: string;
  availableTools: AgentTool[];
  toolVersions: Partial<Record<AgentTool, ToolVersionInfo>>;
}
