/**
 * Machine and Agent Types & Constants
 *
 * Shared types and constants for machine identity and agent management.
 * Used by AgentPanel.tsx and ChatroomAgentDetailsModal.tsx.
 *
 * These mirror the canonical definitions in packages/cli/src/infrastructure/machine/types.ts
 * but are maintained separately since the CLI is a Node package and can't be imported
 * directly by the Next.js frontend.
 */

// ─── Types ──────────────────────────────────────────────────────────

export type AgentTool = 'opencode' | 'claude' | 'cursor';

export interface ToolVersionInfo {
  version: string;
  major: number;
}

export interface MachineInfo {
  machineId: string;
  hostname: string;
  os: string;
  availableTools: AgentTool[];
  toolVersions: Partial<Record<AgentTool, ToolVersionInfo>>;
  daemonConnected: boolean;
  lastSeenAt: number;
}

export interface AgentConfig {
  machineId: string;
  hostname: string;
  role: string;
  agentType: AgentTool;
  workingDir: string;
  model?: string;
  daemonConnected: boolean;
  availableTools: AgentTool[];
  updatedAt: number;
  spawnedAgentPid?: number;
  spawnedAt?: number;
}

// ─── Constants ──────────────────────────────────────────────────────

export const TOOL_DISPLAY_NAMES: Record<AgentTool, string> = {
  opencode: 'OpenCode',
  claude: 'Claude Code',
  cursor: 'Cursor Agent',
};

/**
 * Available AI models per agent tool.
 * Models sourced from `opencode models` using provider/model-id format.
 * First model in each array is the default.
 *
 * Note: opencode models are dynamic and depend on user's configured providers.
 * A future improvement could detect models dynamically via the backend.
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
  claude: [],
  cursor: [],
};

/**
 * Short display names for models in the UI.
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
