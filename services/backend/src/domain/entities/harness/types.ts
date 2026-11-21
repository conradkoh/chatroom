/**
 * Harness capability configuration for remote agent runtimes.
 *
 * Each SDK harness has a dedicated config file exporting its capabilities.
 * Use `getHarnessCapabilities()` for runtime lookup by `AgentHarness`.
 *
 * Wire/lifecycle event catalogs and helpers: `lifecycle-events.ts` (daemon only).
 */

import { isAgentHarness, type AgentHarness } from '../agent';
import { claudeSdkCapabilities } from './claude-sdk.config';
import { codexSdkCapabilities } from './codex-sdk.config';
import { cursorSdkCapabilities } from './cursor-sdk.config';
import { opencodeSdkCapabilities } from './opencode-sdk.config';
import { piSdkCapabilities } from './pi-sdk.config';

/** Canonical lifecycle events at the harness ↔ daemon boundary. */
export type HarnessLifecycleEventKind =
  'lifecycle.turn.completed' | 'lifecycle.output.activity' | 'lifecycle.process.exited';

/** Wire/protocol events before adaptation to lifecycle events. */
export type HarnessWireEventKind =
  | 'wire.log.agent_end'
  | 'sdk.cursor.message'
  | 'sdk.cursor.run.completed'
  | 'sdk.opencode.session.idle'
  | 'sdk.opencode.session.event'
  | 'sdk.pi.session.event'
  | 'sdk.claude.message'
  | 'sdk.codex.event';

/** Which lifecycle callbacks a harness implements on `SpawnResult`. */
export interface HarnessLifecycleCapabilities {
  /** Maps to `SpawnResult.onAgentEnd` / `lifecycle.turn.completed`. */
  turnCompleted: boolean;
  /** Maps to `SpawnResult.onOutput` / `lifecycle.output.activity`. */
  outputActivity: boolean;
  /** Maps to `SpawnResult.onExit` / `lifecycle.process.exited`. */
  processExited: boolean;
}

export interface HarnessCapabilities {
  /** Lifecycle events this harness surfaces at the integration boundary. */
  lifecycle: HarnessLifecycleCapabilities;
  /**
   * Wire/protocol events this harness may emit before adaptation.
   * Each entry must be a kind in `HARNESS_WIRE_EVENT_KINDS` (enforced in types.test.ts).
   */
  wireEvents: readonly HarnessWireEventKind[];
}

const HARNESS_CAPABILITIES: Record<AgentHarness, HarnessCapabilities> = {
  'claude-sdk': claudeSdkCapabilities,
  'codex-sdk': codexSdkCapabilities,
  'cursor-sdk': cursorSdkCapabilities,
  'opencode-sdk': opencodeSdkCapabilities,
  'pi-sdk': piSdkCapabilities,
};

// fallow-ignore-next-line unused-export
export function getHarnessCapabilities(harness: AgentHarness): HarnessCapabilities {
  return HARNESS_CAPABILITIES[harness];
}

/**
 * True for an SDK harness that receives injected tasks. Custom agents pass `undefined`
 * and get `false`, so they keep the CLI prompt path. Retired or unknown names are `false`.
 */
export function isNativeHarness(harness: string | null | undefined): boolean {
  return typeof harness === 'string' && isAgentHarness(harness);
}
