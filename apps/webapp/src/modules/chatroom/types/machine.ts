/**
 * Machine and Agent Types & Constants
 *
 * Shared types and constants for machine identity and agent management.
 * Used by AgentPanel.tsx and AgentControls.tsx.
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
import {
  decodeModelVariant,
  formatModelVariantParamsSuffix,
} from '@workspace/backend/src/domain/entities/harness/model-variant';
import { getHarnessCapabilities } from '@workspace/backend/src/domain/entities/harness/types';

import { getBaseModelId } from '../utils/modelSelection';

export type { AgentHarness, AgentStopReason, HarnessVersionInfo };

export interface MachineInfo {
  machineId: string;
  hostname: string;
  alias?: string;
  os: string;
  availableHarnesses: AgentHarness[];
  harnessVersions: Partial<Record<AgentHarness, HarnessVersionInfo>>;
  // availableModels removed in v1.38.4 — now served via getMachineModels query / useMachineModels hook
}

export interface AgentConfig {
  machineId: string;
  hostname: string;
  alias?: string;
  role: string;
  agentType: AgentHarness;
  workingDir: string;
  model?: string;
  daemonConnected?: boolean;
  availableHarnesses: AgentHarness[];
  updatedAt: number;
  spawnedAgentPid?: number;
  spawnedAt?: number;
  /**
   * The resume-session preference the agent was started with (from the backend
   * team config). Used to display the actual running value rather than local
   * form state. Undefined for configs that were never started after this field
   * was introduced.
   */
  wantResume?: boolean;
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
        /** When true (default), resume from the daemon's last session on first launch. */
        wantResume?: boolean;
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
      type: 'restart-agent';
      payload: {
        chatroomId: Id<'chatroom_rooms'>;
        role: string;
        model?: string;
        agentHarness: AgentHarness;
        workingDir?: string;
        wantResume?: boolean;
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
  'pi-sdk': 'Pi (SDK)',
  cursor: 'Cursor (CLI)',
  'cursor-sdk': 'Cursor (SDK)',
  claude: 'Claude Code',
  'claude-sdk': 'Claude (SDK)',
  'codex-sdk': 'Codex (SDK)',
  commandcode: 'CommandCode',
};

/** Get display name for a harness. Returns a title-cased fallback for unknown harnesses. */
export function getHarnessDisplayName(harness: string): string {
  return HARNESS_DISPLAY_NAMES[harness] ?? harness.charAt(0).toUpperCase() + harness.slice(1);
}

/** Display label for a harness, optionally including daemon-reported version. */
export function formatHarnessLabel(harness: string, version?: HarnessVersionInfo): string {
  return `${getHarnessDisplayName(harness)}${version ? ` v${version.version}` : ''}`;
}

/** Whether stop→start can reconnect to the daemon's preserved session on this machine. */
export function harnessSupportsDaemonMemoryResume(harness: AgentHarness): boolean {
  return getHarnessCapabilities(harness).supportsDaemonMemoryResume;
}

/** Whether the harness receives tasks via direct session injection (no get-next-task loop). */
export function harnessSupportsNativeIntegration(harness: AgentHarness): boolean {
  return getHarnessCapabilities(harness).supportsNativeIntegration;
}

/** Check if a harness is the OpenCode SDK harness. */
export function isOpenCodeSdkHarness(harness: string): boolean {
  return harness === 'opencode-sdk';
}

/** Check if a harness is the Cursor SDK harness. */
export function isCursorSdkHarness(harness: string): boolean {
  return harness === 'cursor-sdk';
}

// ─── Helpers ────────────────────────────────────────────────────────

/** Returns the display name for a machine: alias if set, otherwise hostname. */
export function getMachineDisplayName(machine: { hostname: string; alias?: string }): string {
  return machine.alias || machine.hostname;
}

/**
 * Convert a hyphenated slug to a title-cased display label.
 * Replaces hyphens with spaces and capitalizes each segment.
 *
 * "github-copilot" → "Github Copilot"
 * "gpt-4o" → "Gpt 4o"
 * "claude-sonnet-4.5" → "Claude Sonnet 4.5"
 */
function slugToLabel(slug: string): string {
  return slug
    .split('-')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

/** Friendly labels for bare model slugs (cursor-sdk / cursor CLI). */
const BARE_MODEL_DISPLAY_LABELS: Record<string, string> = {
  auto: 'Auto',
  default: 'Auto',
};

/**
 * Parse an OpenCode model ID (provider/model-slug format) into display parts.
 *
 * OpenCode models use the format "provider/model-slug", e.g.:
 *   "github-copilot/claude-sonnet-4.5" → { provider: "Github Copilot", model: "Claude Sonnet 4.5" }
 *   "opencode/big-pickle" → { provider: "OPENCODE", model: "BIG PICKLE" }
 *
 * For IDs without a slash, the entire string is treated as the model name.
 */
function parseModelId(modelId: string): { provider: string; model: string } {
  const slashIdx = modelId.indexOf('/');
  if (slashIdx === -1) {
    return {
      provider: '',
      model: BARE_MODEL_DISPLAY_LABELS[modelId] ?? slugToLabel(modelId),
    };
  }

  const providerSlug = modelId.substring(0, slashIdx);
  const modelSlug = modelId.substring(slashIdx + 1);

  return {
    provider: slugToLabel(providerSlug),
    model: slugToLabel(modelSlug),
  };
}

export interface ModelDisplayLabelOptions {
  /** Variant param keys to omit from the bracket suffix (e.g. uniform tags across a group). */
  omitParamKeys?: ReadonlySet<string>;
}

/**
 * Get the full display label for a model, including its provider.
 * Uses title-cased slug-to-label normalization.
 * e.g. "github-copilot/gpt-4o" → "Github Copilot / Gpt 4o"
 *
 * Variant params (effort, reasoning) are appended when present.
 */
function filterVariantParams(
  params: Record<string, string>,
  omitParamKeys?: ReadonlySet<string>
): Record<string, string> {
  if (!omitParamKeys) return params;
  return Object.fromEntries(Object.entries(params).filter(([key]) => !omitParamKeys.has(key)));
}

export function getModelDisplayLabel(modelId: string, options?: ModelDisplayLabelOptions): string {
  try {
    const { model, params } = decodeModelVariant(modelId);
    const filteredParams = filterVariantParams(params, options?.omitParamKeys);
    const { provider, model: modelPart } = parseModelId(model);
    const suffix = formatModelVariantParamsSuffix(filteredParams);
    const base = !provider ? modelPart : `${provider} / ${modelPart}`;
    return suffix ? `${base} ${suffix}` : base;
  } catch {
    const { provider, model } = parseModelId(modelId);
    if (!provider) return model;
    return `${provider} / ${model}`;
  }
}

/** Last segment of a provider/model path for compact agent sidebar display. */
export function getCompactModelId(modelId: string): string {
  const parts = getBaseModelId(modelId).split('/').filter(Boolean);
  return parts.at(-1) ?? modelId;
}
