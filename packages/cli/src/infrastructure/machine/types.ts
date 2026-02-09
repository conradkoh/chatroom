/**
 * Machine Identity Types
 *
 * Type definitions for machine configuration and agent management.
 */

/**
 * Supported AI agent harnesses that can be spawned.
 *
 * "Harness" refers to the AI development environment / tool runner
 * (e.g. Cursor, OpenCode, Claude). This avoids confusion with the AI
 * concept of "tools" (read file, write file, web search, etc.).
 */
export type AgentHarness = 'opencode';

/**
 * All supported agent harnesses
 */
export const AGENT_HARNESSES: AgentHarness[] = ['opencode'];

/**
 * Command names for each agent harness (used for detection)
 */
export const AGENT_HARNESS_COMMANDS: Record<AgentHarness, string> = {
  opencode: 'opencode',
};

/**
 * Detected harness version info
 */
export interface HarnessVersionInfo {
  /** Full version string (e.g. "1.2.3") */
  version: string;
  /** Major version number for compatibility gating */
  major: number;
}

/**
 * Per-chatroom, per-role agent context (static config, stored in machine.json)
 *
 * Runtime state like spawned PIDs is stored separately in
 * ~/.chatroom/machines/state/<machine-id>.json — see daemon-state.ts.
 */
export interface AgentContext {
  /** Which harness was used for this role */
  agentType: AgentHarness;
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
  /** Agent harnesses detected as available */
  availableHarnesses: AgentHarness[];
  /** Detected harness versions (keyed by harness name) */
  harnessVersions: Partial<Record<AgentHarness, HarnessVersionInfo>>;
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
  availableHarnesses: AgentHarness[];
  harnessVersions: Partial<Record<AgentHarness, HarnessVersionInfo>>;
}
