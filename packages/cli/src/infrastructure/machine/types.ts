/**
 * Machine Identity Types
 *
 * Type definitions for machine configuration and agent management.
 */

/**
 * Supported AI agent tools that can be spawned
 */
export type AgentTool = 'opencode';

/**
 * All supported agent tools
 */
export const AGENT_TOOLS: AgentTool[] = ['opencode'];

/**
 * Command names for each agent tool (used for detection)
 */
export const AGENT_TOOL_COMMANDS: Record<AgentTool, string> = {
  opencode: 'opencode',
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
 * For opencode, models are sourced from `opencode models` and use the
 * provider/model-id format. The first model in each array is the default.
 *
 * Note: opencode models are dynamic and depend on user's configured providers.
 * These are the commonly available models as of v1.x. A future improvement
 * could detect models dynamically via `opencode models` at runtime.
 */
export const TOOL_MODELS: Record<AgentTool, string[]> = {
  opencode: [
    'github-copilot/claude-sonnet-4.5',
    'github-copilot/claude-opus-4.6',
    'github-copilot/claude-opus-4.5',
    'github-copilot/gpt-5.2',
    'github-copilot/gpt-5.2-codex',
    'github-copilot/gpt-5.1-codex-max',
    'github-copilot/gemini-3-flash-preview',
    'github-copilot/claude-haiku-4.5',
    'opencode/big-pickle',
  ],
};

/**
 * Display names for AI models (short labels for UI).
 * Maps full model IDs to human-readable short names.
 */
export const MODEL_DISPLAY_NAMES: Record<string, string> = {
  'github-copilot/claude-sonnet-4.5': 'Sonnet 4.5',
  'github-copilot/claude-opus-4.6': 'Opus 4.6',
  'github-copilot/claude-opus-4.5': 'Opus 4.5',
  'github-copilot/gpt-5.2': 'GPT-5.2',
  'github-copilot/gpt-5.2-codex': 'GPT-5.2 Codex',
  'github-copilot/gpt-5.1-codex-max': 'GPT-5.1 Codex Max',
  'github-copilot/gemini-3-flash-preview': 'Gemini 3 Flash',
  'github-copilot/claude-haiku-4.5': 'Haiku 4.5',
  'opencode/big-pickle': 'Big Pickle',
};

/**
 * Per-chatroom, per-role agent context (static config, stored in machine.json)
 *
 * Runtime state like spawned PIDs is stored separately in
 * ~/.chatroom/machines/state/<machine-id>.json — see daemon-state.ts.
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
