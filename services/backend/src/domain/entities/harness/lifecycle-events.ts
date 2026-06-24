/**
 * Harness lifecycle and wire-event catalogs and helpers.
 *
 * Imported by CLI/daemon code and tests — not re-exported from `types.ts` so the
 * webapp client bundle (which only needs `getHarnessCapabilities`) does not pull
 * this module through Turbopack.
 *
 * Type definitions live in `types.ts`.
 */

import type { HarnessLifecycleEventKind, HarnessRuntimeKind, HarnessWireEventKind } from './types';

// ─── Runtime kind ─────────────────────────────────────────────────────────────

export const HARNESS_RUNTIME_KINDS = [
  'cli',
  'sdk',
] as const satisfies readonly HarnessRuntimeKind[];

// ─── Daemon lifecycle events (integration boundary) ───────────────────────────

export const HARNESS_LIFECYCLE_EVENT_KINDS = [
  'lifecycle.turn.completed',
  'lifecycle.output.activity',
  'lifecycle.process.exited',
] as const satisfies readonly HarnessLifecycleEventKind[];

/** Human-readable descriptions for lifecycle events (docs, UI, logs). */
export const HARNESS_LIFECYCLE_EVENT_DESCRIPTIONS: Record<HarnessLifecycleEventKind, string> = {
  'lifecycle.turn.completed':
    'One agent turn finished; daemon may call resumeTurn (resumable harnesses) or continue the turn loop.',
  'lifecycle.output.activity':
    'Output or stream activity (stdout/stderr or SDK stream); throttled token-activity reporting.',
  'lifecycle.process.exited':
    'OS-tracked child process exited (keeper or CLI binary); drives stop reason and crash recovery.',
};

// ─── Wire / protocol events (harness-specific) ────────────────────────────────

export const HARNESS_WIRE_EVENT_KINDS = [
  'wire.ndjson.agent_start',
  'wire.ndjson.agent_end',
  'wire.ndjson.message_update',
  'wire.ndjson.tool_execution_start',
  'wire.ndjson.tool_execution_end',
  'wire.ndjson.get_state',
  'wire.log.agent_end',
  'sdk.cursor.message',
  'sdk.cursor.run.completed',
  'sdk.opencode.session.idle',
  'sdk.opencode.session.event',
  'sdk.pi.session.event',
] as const satisfies readonly HarnessWireEventKind[];

export interface HarnessWireEventSpec {
  readonly kind: HarnessWireEventKind;
  readonly description: string;
  /** Runtime kinds that may produce this wire event. */
  readonly emittedBy: readonly HarnessRuntimeKind[];
  /**
   * When true, no SDK harness will ever emit this event (CLI subprocess protocol only).
   */
  readonly cliOnly: boolean;
}

export const HARNESS_WIRE_EVENT_SPECS: Record<HarnessWireEventKind, HarnessWireEventSpec> = {
  'wire.ndjson.agent_start': {
    kind: 'wire.ndjson.agent_start',
    description: 'Pi RPC: agent started a turn.',
    emittedBy: ['cli'],
    cliOnly: true,
  },
  'wire.ndjson.agent_end': {
    kind: 'wire.ndjson.agent_end',
    description: 'Pi RPC: agent finished a turn (maps to lifecycle.turn.completed).',
    emittedBy: ['cli'],
    cliOnly: true,
  },
  'wire.ndjson.message_update': {
    kind: 'wire.ndjson.message_update',
    description: 'Pi RPC: streaming text or thinking deltas.',
    emittedBy: ['cli'],
    cliOnly: true,
  },
  'wire.ndjson.tool_execution_start': {
    kind: 'wire.ndjson.tool_execution_start',
    description: 'Pi RPC: tool invocation started.',
    emittedBy: ['cli'],
    cliOnly: true,
  },
  'wire.ndjson.tool_execution_end': {
    kind: 'wire.ndjson.tool_execution_end',
    description: 'Pi RPC: tool invocation finished.',
    emittedBy: ['cli'],
    cliOnly: true,
  },
  'wire.ndjson.get_state': {
    kind: 'wire.ndjson.get_state',
    description: 'Pi RPC: session id response for harnessSessionId.',
    emittedBy: ['cli'],
    cliOnly: true,
  },
  'wire.log.agent_end': {
    kind: 'wire.log.agent_end',
    description:
      'Log line suffix `agent_end]` for daemon log parity; not a wire protocol. SDK may write this after synthetic turn end.',
    emittedBy: ['cli', 'sdk'],
    cliOnly: false,
  },
  'sdk.cursor.message': {
    kind: 'sdk.cursor.message',
    description: 'Cursor SDK run.stream() message (assistant, tool_call, status, etc.).',
    emittedBy: ['sdk'],
    cliOnly: false,
  },
  'sdk.cursor.run.completed': {
    kind: 'sdk.cursor.run.completed',
    description:
      'Cursor SDK run.wait() succeeded; adapter emits lifecycle.turn.completed (not wire.ndjson.agent_end).',
    emittedBy: ['sdk'],
    cliOnly: false,
  },
  'sdk.opencode.session.idle': {
    kind: 'sdk.opencode.session.idle',
    description: 'OpenCode SDK session idle / turn boundary via event forwarder.',
    emittedBy: ['sdk'],
    cliOnly: false,
  },
  'sdk.opencode.session.event': {
    kind: 'sdk.opencode.session.event',
    description: 'OpenCode SDK SSE session event (non-idle).',
    emittedBy: ['sdk'],
    cliOnly: false,
  },
  'sdk.pi.session.event': {
    kind: 'sdk.pi.session.event',
    description: 'Pi SDK AgentSessionEvent from session.subscribe().',
    emittedBy: ['sdk'],
    cliOnly: false,
  },
};

/** Wire events that only CLI-driven harnesses emit (SDK harnesses never produce these). */
export const CLI_ONLY_WIRE_EVENT_KINDS = HARNESS_WIRE_EVENT_KINDS.filter(
  (kind) => HARNESS_WIRE_EVENT_SPECS[kind].cliOnly
);

export function isCliOnlyWireEvent(kind: HarnessWireEventKind): boolean {
  return HARNESS_WIRE_EVENT_SPECS[kind].cliOnly;
}

export function wireEventEmittedByRuntime(
  kind: HarnessWireEventKind,
  runtime: HarnessRuntimeKind
): boolean {
  return HARNESS_WIRE_EVENT_SPECS[kind].emittedBy.includes(runtime);
}

/**
 * Maps a wire event to the lifecycle event the daemon consumes, when applicable.
 */
export function wireEventToLifecycle(
  kind: HarnessWireEventKind
): HarnessLifecycleEventKind | undefined {
  switch (kind) {
    case 'wire.ndjson.agent_end':
    case 'wire.log.agent_end':
    case 'sdk.cursor.run.completed':
    case 'sdk.opencode.session.idle':
      return 'lifecycle.turn.completed';
    default:
      return undefined;
  }
}
