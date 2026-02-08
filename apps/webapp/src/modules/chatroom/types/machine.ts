/**
 * Machine and Agent Types & Constants
 *
 * Shared types and constants for machine identity and agent management.
 * Used by AgentPanel.tsx and ChatroomAgentDetailsModal.tsx.
 *
 * These mirror the canonical definitions in packages/cli/src/infrastructure/machine/types.ts
 * but are maintained separately since the CLI is a Node package and can't be imported
 * directly by the Next.js frontend.
 *
 * "Harness" refers to the AI development environment / tool runner
 * (e.g. Cursor, OpenCode, Claude). This avoids confusion with the AI
 * concept of "tools" (read file, write file, web search, etc.).
 */

// ─── Types ──────────────────────────────────────────────────────────

export type AgentHarness = 'opencode';

export interface HarnessVersionInfo {
  version: string;
  major: number;
}

export interface MachineInfo {
  machineId: string;
  hostname: string;
  os: string;
  availableHarnesses: AgentHarness[];
  harnessVersions: Partial<Record<AgentHarness, HarnessVersionInfo>>;
  /** Available AI models discovered dynamically via `opencode models` */
  availableModels: string[];
  daemonConnected: boolean;
  lastSeenAt: number;
}

export interface AgentConfig {
  machineId: string;
  hostname: string;
  role: string;
  agentType: AgentHarness;
  workingDir: string;
  model?: string;
  daemonConnected: boolean;
  availableHarnesses: AgentHarness[];
  updatedAt: number;
  spawnedAgentPid?: number;
  spawnedAt?: number;
}

// ─── Constants ──────────────────────────────────────────────────────

export const HARNESS_DISPLAY_NAMES: Record<AgentHarness, string> = {
  opencode: 'OpenCode',
};

// ─── Helpers ────────────────────────────────────────────────────────

/**
 * Title-case a hyphenated slug: "claude-sonnet-4.5" → "Claude Sonnet 4.5"
 */
function titleCase(slug: string): string {
  return slug
    .split('-')
    .map((word) => (word.length > 0 ? word.charAt(0).toUpperCase() + word.slice(1) : word))
    .join(' ');
}

/**
 * Parse an OpenCode model ID (provider/model-slug format) into display parts.
 *
 * OpenCode models use the format "provider/model-slug", e.g.:
 *   "github-copilot/claude-sonnet-4.5" → { provider: "Github Copilot", model: "Claude Sonnet 4.5" }
 *   "opencode/big-pickle" → { provider: "Opencode", model: "Big Pickle" }
 *
 * For IDs without a slash, the entire string is treated as the model name.
 */
function parseModelId(modelId: string): { provider: string; model: string } {
  const slashIdx = modelId.indexOf('/');
  if (slashIdx === -1) {
    return { provider: '', model: titleCase(modelId) };
  }

  const providerSlug = modelId.substring(0, slashIdx);
  const modelSlug = modelId.substring(slashIdx + 1);

  return {
    provider: titleCase(providerSlug),
    model: titleCase(modelSlug),
  };
}

/**
 * Get the full display label for a model, including its provider.
 * e.g. "Github Copilot / Claude Sonnet 4.5"
 *
 * Uses algorithmic transformation — no hardcoded model name mappings.
 * This handles the OpenCode "provider/model-slug" format.
 */
export function getModelDisplayLabel(modelId: string): string {
  const { provider, model } = parseModelId(modelId);
  if (!provider) return model;
  return `${provider} / ${model}`;
}

/**
 * Get only the short model name (without provider).
 * e.g. "Claude Sonnet 4.5" or "Big Pickle"
 */
export function getModelShortName(modelId: string): string {
  const { model } = parseModelId(modelId);
  return model;
}
