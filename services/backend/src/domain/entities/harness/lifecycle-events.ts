/**
 * Harness lifecycle and wire-event catalogs and helpers.
 *
 * Imported by daemon code and tests — not re-exported from `types.ts`, so client
 * bundles that import `types.ts` do not pull this module in.
 *
 * Type definitions live in `types.ts`.
 */

import type { HarnessLifecycleEventKind, HarnessWireEventKind } from './types';

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
  'wire.log.agent_end',
  'sdk.cursor.message',
  'sdk.cursor.run.completed',
  'sdk.opencode.session.idle',
  'sdk.opencode.session.event',
  'sdk.pi.session.event',
  'sdk.claude.message',
  'sdk.codex.event',
] as const satisfies readonly HarnessWireEventKind[];

export interface HarnessWireEventSpec {
  readonly kind: HarnessWireEventKind;
  readonly description: string;
}

export const HARNESS_WIRE_EVENT_SPECS: Record<HarnessWireEventKind, HarnessWireEventSpec> = {
  'wire.log.agent_end': {
    kind: 'wire.log.agent_end',
    description:
      'Log line suffix `agent_end]` for daemon log parity; not a wire protocol. SDK may write this after synthetic turn end.',
  },
  'sdk.cursor.message': {
    kind: 'sdk.cursor.message',
    description: 'Cursor SDK run.stream() message (assistant, tool_call, status, etc.).',
  },
  'sdk.cursor.run.completed': {
    kind: 'sdk.cursor.run.completed',
    description: 'Cursor SDK run.wait() succeeded; adapter emits lifecycle.turn.completed.',
  },
  'sdk.opencode.session.idle': {
    kind: 'sdk.opencode.session.idle',
    description: 'OpenCode SDK session idle / turn boundary via event forwarder.',
  },
  'sdk.opencode.session.event': {
    kind: 'sdk.opencode.session.event',
    description: 'OpenCode SDK SSE session event (non-idle).',
  },
  'sdk.pi.session.event': {
    kind: 'sdk.pi.session.event',
    description: 'Pi SDK AgentSessionEvent from session.subscribe().',
  },
  'sdk.claude.message': {
    kind: 'sdk.claude.message',
    description: 'Claude Agent SDK query() stream message (assistant, stream_event, result, etc.).',
  },
  'sdk.codex.event': {
    kind: 'sdk.codex.event',
    description:
      'Codex SDK thread.runStreamed() event (item.*, turn.completed, turn.failed, error).',
  },
};

/**
 * Maps a wire event to the lifecycle event the daemon consumes, when applicable.
 */
export function wireEventToLifecycle(
  kind: HarnessWireEventKind
): HarnessLifecycleEventKind | undefined {
  switch (kind) {
    case 'wire.log.agent_end':
    case 'sdk.cursor.run.completed':
    case 'sdk.opencode.session.idle':
      return 'lifecycle.turn.completed';
    default:
      return undefined;
  }
}
