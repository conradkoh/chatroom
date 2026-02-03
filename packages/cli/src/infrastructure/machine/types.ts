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
 * Machine configuration stored in ~/.chatroom/machine.json
 */
export interface MachineConfig {
  /** UUID generated once per machine */
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
  /** Per-chatroom agent configurations */
  chatroomAgents: Record<string, Record<string, AgentContext>>;
}

/**
 * Minimal machine info for registration
 */
export interface MachineRegistrationInfo {
  machineId: string;
  hostname: string;
  os: string;
  availableTools: AgentTool[];
}
