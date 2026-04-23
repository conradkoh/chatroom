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
  HarnessCapabilities,
  HarnessCapabilitiesByHarness,
} from '@workspace/backend/src/domain/entities/agent';

export type {
  AgentHarness,
  AgentStopReason,
  HarnessVersionInfo,
  HarnessCapabilities,
  HarnessCapabilitiesByHarness,
};

export interface MachineInfo {
  machineId: string;
  hostname: string;
  alias?: string;
  os: string;
  availableHarnesses: AgentHarness[];
  harnessVersions: Partial<Record<AgentHarness, HarnessVersionInfo>>;
  /** Available AI models discovered dynamically, keyed by harness name */
  availableModels: Record<string, string[]>;
  /** OpenCode agent profile names per harness (e.g. opencode-sdk → build, plan) */
  availableAgents?: Record<string, string[]>;
  /** Per-harness driver capabilities (what features each harness supports) */
  harnessCapabilities?: HarnessCapabilitiesByHarness;
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
  opencodeAgentName?: string;
  daemonConnected: boolean;
  availableHarnesses: AgentHarness[];
  /** Denormalized from the machine row for model / agent pickers */
  availableModels: Record<string, string[]>;
  availableAgents?: Record<string, string[]>;
  harnessCapabilities?: HarnessCapabilitiesByHarness;
  updatedAt: number;
  spawnedAgentPid?: number;
  spawnedAt?: number;
  sessionId?: string;
  serverUrl?: string;
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
        opencodeAgentName?: string;
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
      type: 'abort-agent';
      payload: {
        chatroomId: Id<'chatroom_rooms'>;
        role: string;
      };
    }
  | {
      machineId: string;
      type: 'compact-agent';
      payload: {
        chatroomId: Id<'chatroom_rooms'>;
        role: string;
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

// ─── Helpers ────────────────────────────────────────────────────────

/** True when the harness is the OpenCode SDK integration (not the CLI harness). */
export function isOpenCodeSdkHarness(harness: AgentHarness | null): harness is 'opencode-sdk' {
  return harness === 'opencode-sdk';
}

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

/**
 * Get the capabilities for a specific harness, or undefined if not available.
 *
 * Returns the full HarnessCapabilities object if the harness has registered capabilities,
 * or undefined if the harness is unknown or has no capabilities data.
 */
export function getHarnessCapabilities(
  machine: { harnessCapabilities?: HarnessCapabilitiesByHarness },
  harness: AgentHarness
): HarnessCapabilities | undefined {
  return machine.harnessCapabilities?.[harness];
}
