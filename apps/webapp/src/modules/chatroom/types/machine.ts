/**
 * Machine and Agent Types & Constants
 *
 * Shared types and constants for machine identity and agent management.
 * Used by AgentPanel.tsx and AgentConfigTabs.tsx.
 *
 * AgentHarness and HarnessVersionInfo are canonical in the backend domain layer.
 *
 * "Harness" refers to the AI development environment / tool runner
 * (e.g. Cursor, OpenCode, Pi). This avoids confusion with the AI
 * concept of "tools" (read file, write file, web search, etc.).
 */

import type { Id } from '@workspace/backend/convex/_generated/dataModel';
import type {
  AgentHarness,
  AgentStopReason,
  HarnessVersionInfo,
} from '@workspace/backend/src/domain/entities/agent';

export type { AgentHarness, AgentStopReason, HarnessVersionInfo };

export interface MachineInfo {
  machineId: string;
  hostname: string;
  alias?: string;
  os: string;
  availableHarnesses: AgentHarness[];
  harnessVersions: Partial<Record<AgentHarness, HarnessVersionInfo>>;
  /** Available AI models discovered dynamically, keyed by harness name */
  availableModels: Record<string, string[]>;
  daemonConnected: boolean;
  lastSeenAt: number;
}

export interface AgentConfig {
  machineId: string;
  hostname: string;
  alias?: string;
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

export type SendCommandArgs =
  | {
      machineId: string;
      type: 'start-agent';
      payload: {
        chatroomId: Id<'chatroom_rooms'>;
        role: string;
        model?: string;
        agentHarness: AgentHarness;
        workingDir?: string;
        /** Allows switching to a different machine when the role was already bound elsewhere. */
        allowNewMachine?: boolean;
      };
    }
  | {
      machineId: string;
      type: 'stop-agent';
      payload: {
        chatroomId: Id<'chatroom_rooms'>;
        role: string;
        reason?: AgentStopReason;
      };
    }
  | {
      machineId: string;
      type: 'ping';
    }
  | {
      machineId: string;
      type: 'status';
    };

export type SendCommandFn = (args: SendCommandArgs) => Promise<unknown>;

// ─── Constants ──────────────────────────────────────────────────────

export const HARNESS_DISPLAY_NAMES: Record<string, string> = {
  opencode: 'OpenCode (CLI)',
  'opencode-sdk': 'OpenCode (SDK)',
  pi: 'Pi',
  cursor: 'Cursor',
};

/** Get display name for a harness. Returns a title-cased fallback for unknown harnesses. */
export function getHarnessDisplayName(harness: string): string {
  return HARNESS_DISPLAY_NAMES[harness] ?? harness.charAt(0).toUpperCase() + harness.slice(1);
}

/** Check if a harness is the OpenCode SDK harness. */
export function isOpenCodeSdkHarness(harness: string): boolean {
  return harness === 'opencode-sdk';
}

// ─── Helpers ────────────────────────────────────────────────────────

/** Returns the display name for a machine: alias if set, otherwise hostname. */
export function getMachineDisplayName(machine: { hostname: string; alias?: string }): string {
  return machine.alias || machine.hostname;
}

/**
 * Convert a hyphenated slug to an uppercase display label.
 * Replaces hyphens with spaces and uppercases all characters.
 *
 * "github-copilot" → "GITHUB COPILOT"
 * "gpt-4o" → "GPT 4O"
 * "claude-sonnet-4.5" → "CLAUDE SONNET 4.5"
 */
function slugToLabel(slug: string): string {
  return slug.replace(/-/g, ' ').toUpperCase();
}

/**
 * Parse an OpenCode model ID (provider/model-slug format) into display parts.
 *
 * OpenCode models use the format "provider/model-slug", e.g.:
 *   "github-copilot/claude-sonnet-4.5" → { provider: "GITHUB COPILOT", model: "CLAUDE SONNET 4.5" }
 *   "opencode/big-pickle" → { provider: "OPENCODE", model: "BIG PICKLE" }
 *
 * For IDs without a slash, the entire string is treated as the model name.
 */
function parseModelId(modelId: string): { provider: string; model: string } {
  const slashIdx = modelId.indexOf('/');
  if (slashIdx === -1) {
    return { provider: '', model: slugToLabel(modelId) };
  }

  const providerSlug = modelId.substring(0, slashIdx);
  const modelSlug = modelId.substring(slashIdx + 1);

  return {
    provider: slugToLabel(providerSlug),
    model: slugToLabel(modelSlug),
  };
}

/**
 * Get the full display label for a model, including its provider.
 * Returns an UPPERCASE label using slug-to-label normalization.
 * e.g. "github-copilot/gpt-4o" → "GITHUB COPILOT / GPT 4O"
 *
 * Uses algorithmic transformation — no hardcoded model name mappings.
 * This handles the OpenCode "provider/model-slug" format.
 */
export function getModelDisplayLabel(modelId: string): string {
  const { provider, model } = parseModelId(modelId);
  if (!provider) return model;
  return `${provider} / ${model}`;
}
