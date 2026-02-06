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

export type AgentTool = 'opencode';

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
  /** Available AI models discovered dynamically via `opencode models` */
  availableModels: string[];
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
};

/**
 * Provider display names for the UI.
 * Maps the provider prefix in model IDs to human-readable names.
 */
export const PROVIDER_DISPLAY_NAMES: Record<string, string> = {
  'github-copilot': 'GitHub Copilot',
  opencode: 'OpenCode',
  openrouter: 'OpenRouter',
  vercel: 'Vercel',
};

/**
 * Short display names for models in the UI.
 * Maps full model IDs to human-readable short names (model name only).
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

// ─── Helpers ────────────────────────────────────────────────────────

/**
 * Get the full display label for a model, including its provider.
 * e.g. "GitHub Copilot / Sonnet 4.5" or "OpenCode / Big Pickle"
 *
 * Falls back to the raw model ID if no display name is found.
 */
export function getModelDisplayLabel(modelId: string): string {
  const slashIdx = modelId.indexOf('/');
  if (slashIdx === -1) return modelId;

  const providerKey = modelId.substring(0, slashIdx);
  const providerName = PROVIDER_DISPLAY_NAMES[providerKey] ?? providerKey;
  const modelName = MODEL_DISPLAY_NAMES[modelId] ?? modelId.substring(slashIdx + 1);

  return `${providerName} / ${modelName}`;
}

/**
 * Get only the short model name (without provider).
 * e.g. "Sonnet 4.5" or "Big Pickle"
 */
export function getModelShortName(modelId: string): string {
  return MODEL_DISPLAY_NAMES[modelId] ?? modelId;
}
