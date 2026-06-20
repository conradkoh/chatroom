/**
 * Harness capability configuration for remote agent runtimes.
 *
 * Each harness has a dedicated config file exporting its capabilities.
 * Use `getHarnessCapabilities()` for runtime lookup by `AgentHarness`.
 *
 * Wire/lifecycle event catalogs and helpers: `lifecycle-events.ts` (CLI/daemon only).
 */

import type { AgentHarness } from '../agent';
import { claudeCapabilities } from './claude.config';
import { commandcodeCapabilities } from './commandcode.config';
import { copilotCapabilities } from './copilot.config';
import { cursorSdkCapabilities } from './cursor-sdk.config';
import { cursorCapabilities } from './cursor.config';
import { opencodeSdkCapabilities } from './opencode-sdk.config';
import { opencodeCapabilities } from './opencode.config';
import { piCapabilities } from './pi.config';

/** How the harness implementation hosts the agent runtime. */
export type HarnessRuntimeKind = 'cli' | 'sdk';

/** Canonical lifecycle events at the harness ↔ daemon boundary. */
export type HarnessLifecycleEventKind =
  | 'lifecycle.turn.completed'
  | 'lifecycle.output.activity'
  | 'lifecycle.process.exited';

/**
 * Wire/protocol events before adaptation to lifecycle events.
 * Kinds prefixed with `wire.ndjson.` are CLI-only (see `lifecycle-events.ts`).
 */
export type HarnessWireEventKind =
  | 'wire.ndjson.agent_start'
  | 'wire.ndjson.agent_end'
  | 'wire.ndjson.message_update'
  | 'wire.ndjson.tool_execution_start'
  | 'wire.ndjson.tool_execution_end'
  | 'wire.ndjson.get_state'
  | 'wire.log.agent_end'
  | 'sdk.cursor.message'
  | 'sdk.cursor.run.completed'
  | 'sdk.opencode.session.idle'
  | 'sdk.opencode.session.event';

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
  /** CLI subprocess vs in-process SDK (+ keeper PID). */
  runtimeKind: HarnessRuntimeKind;
  /**
   * Whether this harness supports resuming a session after lifecycle.turn.completed
   * (instead of a full cold restart). When true, the daemon calls resumeTurn in-process
   * and may use resumeFromDaemonMemory after stop→start.
   */
  supportsSessionResume: boolean;
  /** Daemon injects tasks into session context — no get-next-task loop. */
  supportsNativeIntegration: boolean;
  /** Lifecycle events this harness surfaces at the integration boundary. */
  lifecycle: HarnessLifecycleCapabilities;
  /**
   * Wire/protocol events this harness may emit before adaptation.
   * SDK harnesses must not list any `cliOnly` kinds (enforced in types.test.ts).
   */
  wireEvents: readonly HarnessWireEventKind[];
}

const HARNESS_CAPABILITIES: Record<AgentHarness, HarnessCapabilities> = {
  claude: claudeCapabilities,
  commandcode: commandcodeCapabilities,
  copilot: copilotCapabilities,
  cursor: cursorCapabilities,
  'cursor-sdk': cursorSdkCapabilities,
  opencode: opencodeCapabilities,
  'opencode-sdk': opencodeSdkCapabilities,
  pi: piCapabilities,
};

export function getHarnessCapabilities(harness: AgentHarness): HarnessCapabilities {
  return HARNESS_CAPABILITIES[harness];
}

export function getHarnessRuntimeKind(harness: AgentHarness): HarnessRuntimeKind {
  return getHarnessCapabilities(harness).runtimeKind;
}

export function isNativeHarness(harness: AgentHarness | string | undefined | null): boolean {
  if (harness == null) return false;
  return getHarnessCapabilities(harness as AgentHarness).supportsNativeIntegration;
}
