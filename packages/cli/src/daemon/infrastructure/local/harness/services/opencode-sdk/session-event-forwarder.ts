import type { Writable } from 'node:stream';

import {
  assertNeverOpenCodeSessionStatus,
  parseOpenCodeSessionStatus,
} from './opencode-session-status.js';
import { isTerminalProviderError } from '../../../../../domain/usecase/detect-terminal-provider-error.js';
import type {
  HarnessActivityEvent,
  HarnessActivityKind,
} from '../../../../../services/service-interfaces.js';
import { appendToolInputToPayload, formatTimestampedLogLine } from '../agent-log-format.js';
import { createTurnCompletion, type TurnCompletionResult } from '../turn-completion.js';

export interface SessionEventForwarderOptions {
  sessionId: string;
  role: string;
  target?: Writable | undefined;
  errorTarget?: Writable | undefined;
  now?: (() => string) | undefined;
  /** Human-readable log lines for provider failure classification. */
  onLogLine?: ((line: string) => void) | undefined;
  /** Raw assistant text deltas for missed-handoff delivery. */
  onAssistantText?: ((text: string) => void) | undefined;
  /** Typed harness activity signals for observability and first-progress presence. */
  onActivity?: ((event: HarnessActivityEvent) => void) | undefined;
  /** Max wait while OpenCode reports session.status retry before ending the turn. */
  sessionRetryIdleTimeoutMs?: number | undefined;
}

export interface SessionEventForwarderHandle {
  stop(): void;
  done: Promise<void>;
  /**
   * Register a callback to be invoked when the session goes idle (session.idle event).
   * This signals that the agent has finished its turn and is waiting for input.
   * The AgentProcessManager uses this to terminate the process after a completed turn.
   */
  onAgentEnd: (cb: () => void) => void;
  onTurnResult: (cb: (result: TurnCompletionResult) => void) => void;
  /**
   * Abort the session after a fatal provider error (e.g. rate limit) detected outside
   * the SSE stream — typically from opencode serve stderr logs.
   */
  abortTerminalProviderError(): void;
  /**
   * Re-arm turn-end so the next OpenCode idle can emit agent_end again.
   * No-op after terminal abort.
   */
  armTurnEnd(): void;
}

/**
 * OpenCode V2 event envelope. Unlike V1, the payload lives under `data` (there is
 * no `properties` field) and session-scoped events always carry `data.sessionID`.
 */
interface OpenCodeEvent {
  type: string;
  data?: Record<string, unknown> | undefined;
}

/**
 * Minimal client surface needed by the forwarder. Structurally compatible with
 * the real `@opencode/client` `event` subset — `subscribe()` returns an
 * AsyncIterable of V2Event directly (no `{ stream }` envelope), and is loose
 * enough that tests can supply a fake without satisfying the full client type.
 */
export interface SessionEventForwarderClient {
  event: {
    subscribe: (options?: unknown) => AsyncIterable<OpenCodeEvent>;
  };
}

function formatLogLine(
  options: SessionEventForwarderOptions,
  kind: string,
  payload?: string
): string {
  return formatTimestampedLogLine(options.role, kind, payload, options.now);
}

const RECENT_LOG_LINE_CAP = 20;
const DEFAULT_SESSION_RETRY_IDLE_TIMEOUT_MS = 5 * 60 * 1000;

/** Extract the session id from a V2 event's `data` block. */
function eventSessionId(event: OpenCodeEvent): string | undefined {
  const data = event.data;
  if (!data || typeof data !== 'object') return undefined;
  const sid = data.sessionID;
  return typeof sid === 'string' ? sid : undefined;
}

/** Collect the terminal provider error from an event payload, if any. */
function asStructuredError(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== 'object') return undefined;
  return value as Record<string, unknown>;
}

export function startSessionEventForwarder(
  client: SessionEventForwarderClient,
  options: SessionEventForwarderOptions
): SessionEventForwarderHandle {
  const target: Writable = options.target ?? process.stdout;
  const errorTarget: Writable = options.errorTarget ?? process.stderr;

  let cancelled = false;
  let doneResolve: () => void;
  let sessionStarted = false;
  let terminalAbortRequested = false;
  let activeTurnCompletion = createTurnCompletion();
  const turnResultCallbacks: ((result: TurnCompletionResult) => void)[] = [];
  /** Dedup key `${toolCallId}:${state}` → payload already logged. */
  const seenToolStates = new Map<string, string>();
  /** Tool call id → tool name, learned from session.tool.input.started. */
  const toolNames = new Map<string, string>();
  /** Tool call id → input object, learned from session.tool.called. */
  const toolInputs = new Map<string, unknown>();
  /** Tool call id → start timestamp (ms), for duration reporting. */
  const toolStartTimes = new Map<string, number>();
  let lastStatus: string | undefined;
  const agentEndCallbacks: (() => void)[] = [];
  const recentLogLines: string[] = [];
  let retryIdleTimeout: ReturnType<typeof setTimeout> | undefined;

  const donePromise = new Promise<void>((resolve) => {
    doneResolve = resolve;
  });

  function recordRecentLogLine(line: string): void {
    recentLogLines.push(line);
    if (recentLogLines.length > RECENT_LOG_LINE_CAP) {
      recentLogLines.shift();
    }
  }

  function emitActivity(kind: HarnessActivityKind, source: string): void {
    options.onActivity?.({ kind, source, at: Date.now() });
  }

  function semanticSourceForLogKind(kind: string): string | undefined {
    switch (kind) {
      case 'text':
        return 'opencode.session.text.delta';
      case 'thinking':
        return 'opencode.session.reasoning.delta';
      case 'compacted':
        return 'opencode.session.compaction.ended';
      default:
        if (kind.startsWith('tool:')) {
          return 'opencode.session.tool';
        }
        return undefined;
    }
  }

  function isAgentActivityKind(kind: string): boolean {
    return (
      kind === 'text' || kind === 'thinking' || kind === 'compacted' || kind.startsWith('tool:')
    );
  }

  function logLine(targetStream: Writable, kind: string, payload?: string): void {
    const line = formatLogLine(options, kind, payload);
    if (options.onLogLine) options.onLogLine(line);
    else targetStream.write(`${line}\n`);
    recordRecentLogLine(line);
    if (isAgentActivityKind(kind)) {
      const source = semanticSourceForLogKind(kind);
      if (source) {
        emitActivity('progress', source);
      }
    }
  }

  function clearRetryIdleTimeout(): void {
    if (retryIdleTimeout !== undefined) {
      clearTimeout(retryIdleTimeout);
      retryIdleTimeout = undefined;
    }
  }

  function scheduleRetryIdleTimeout(): void {
    clearRetryIdleTimeout();
    const timeoutMs = options.sessionRetryIdleTimeoutMs ?? DEFAULT_SESSION_RETRY_IDLE_TIMEOUT_MS;
    retryIdleTimeout = setTimeout(() => {
      if (cancelled || terminalAbortRequested) return;
      logLine(target, 'status', 'retry_timeout');
      emitAgentEnd('retry_timeout', 'timed_out');
    }, timeoutMs);
  }

  function attachTurnCompletion(completion: ReturnType<typeof createTurnCompletion>): void {
    completion.onComplete((result) => {
      logLine(
        target,
        'agent_end',
        result.status === 'completed' ? undefined : `reason: ${result.error ?? result.status}`
      );
      for (const cb of turnResultCallbacks) cb(result);
      for (const cb of agentEndCallbacks) cb();
    });
  }

  attachTurnCompletion(activeTurnCompletion);

  function emitAgentEnd(
    reason?: string,
    status: 'completed' | 'failed' | 'timed_out' = 'completed'
  ): void {
    activeTurnCompletion.complete({
      status,
      source: reason ? `opencode.${reason}` : 'opencode.session.idle',
      ...(reason ? { error: reason } : {}),
    });
  }

  function abortTerminalProviderError(): void {
    if (terminalAbortRequested) return;
    terminalAbortRequested = true;
    cancelled = true;
    emitAgentEnd('provider_rate_limit', 'failed');
  }

  function armTurnEnd(): void {
    if (terminalAbortRequested) {
      logLine(target, 'status', 'turn_arm_blocked_terminal');
      return;
    }
    clearRetryIdleTimeout();
    activeTurnCompletion = createTurnCompletion();
    attachTurnCompletion(activeTurnCompletion);
    lastStatus = undefined;
  }

  // ── Event handlers ──────────────────────────────────────────────────────────

  function handleTextDelta(data: { delta?: unknown; sessionID?: unknown }): void {
    const delta = data.delta;
    if (typeof delta === 'string' && delta.length > 0) {
      options.onAssistantText?.(delta);
      logLine(target, 'text', delta);
    }
  }

  function handleReasoningDelta(data: { delta?: unknown }): void {
    const delta = data.delta;
    if (typeof delta === 'string' && delta.length > 0) logLine(target, 'thinking', delta);
  }

  function handleToolInputStarted(data: { id?: unknown; name?: unknown }): number | undefined {
    const id = data.id;
    const name = data.name;
    if (typeof id !== 'string' || typeof name !== 'string') return undefined;
    toolNames.set(id, name);
    const startedAt = Date.now();
    toolStartTimes.set(id, startedAt);
    return startedAt;
  }

  function formatDurationPayload(state: string, startedAt: number | undefined): string {
    if (startedAt === undefined || state === 'running') return state;
    const duration = ((Date.now() - startedAt) / 1000).toFixed(1);
    return `${state} (${duration}s)`;
  }

  function logToolState(id: string, name: string, state: string, input: unknown): void {
    const seenKey = `${id}:${state}`;
    if (seenToolStates.has(seenKey)) return;

    const base = formatDurationPayload(state, toolStartTimes.get(id));
    const payload = input === undefined ? base : appendToolInputToPayload(base, input, name);
    seenToolStates.set(seenKey, payload);
    logLine(target, `tool: ${name}`, payload);

    if (state === 'completed' || state === 'error') {
      seenToolStates.delete(seenKey);
      toolStartTimes.delete(id);
      toolInputs.delete(id);
    }
  }

  function handleToolCalled(data: { id?: unknown; input?: unknown }): void {
    const id = data.id;
    if (typeof id !== 'string') return;
    const name = toolNames.get(id) ?? 'unknown';
    const input = data.input;
    toolInputs.set(id, input);
    if (!toolStartTimes.has(id)) toolStartTimes.set(id, Date.now());
    logToolState(id, name, 'running', input);
  }

  function handleToolTerminal(data: { id?: unknown }, state: 'completed' | 'error'): void {
    const id = data.id;
    if (typeof id !== 'string') return;
    const name = toolNames.get(id) ?? 'unknown';
    logToolState(id, name, state, toolInputs.get(id));
  }

  function formatErrorName(err: Record<string, unknown> | undefined): string {
    if (!err) return 'unknown';
    const name = typeof err.type === 'string' ? err.type : err.name;
    const message = typeof err.message === 'string' ? err.message : undefined;
    if (!name) return message ?? String(err);
    return message ? `${name}: ${message}` : String(name);
  }

  function handleSessionError(data: { error?: unknown }): void {
    emitActivity('failure', 'opencode.session.error');
    const err = asStructuredError(data.error);
    logLine(errorTarget, 'error', formatErrorName(err));
    if (isTerminalProviderError(err)) {
      abortTerminalProviderError();
    }
  }

  function handleSessionIdle(): void {
    clearRetryIdleTimeout();
    if (terminalAbortRequested) return;
    emitAgentEnd();
  }

  /**
   * A single user prompt runs as one "execution". `session.execution.succeeded`
   * is the authoritative end-of-turn signal in OpenCode V2 (V1's `session.idle`
   * is not emitted for ordinary turns).
   */
  function handleExecutionSucceeded(): void {
    clearRetryIdleTimeout();
    if (terminalAbortRequested) return;
    emitAgentEnd();
  }

  function handleExecutionFailed(data: { error?: unknown }): void {
    handleSessionError(data);
    if (terminalAbortRequested) return;
    clearRetryIdleTimeout();
    emitAgentEnd('execution_failed', 'failed');
  }

  function handleExecutionInterrupted(): void {
    clearRetryIdleTimeout();
    if (terminalAbortRequested) return;
    emitActivity('failure', 'opencode.session.execution.interrupted');
    emitAgentEnd('execution_interrupted', 'failed');
  }

  /**
   * A scheduled retry carries the provider error. Log it for classification and
   * start the retry-idle timeout so a stuck retry still ends the turn.
   */
  function handleRetryScheduled(data: { error?: unknown }): void {
    if (terminalAbortRequested) return;
    handleSessionError(data);
    if (terminalAbortRequested) return;
    emitActivity('waiting', 'opencode.session.retry.scheduled');
    scheduleRetryIdleTimeout();
  }

  function handleSessionStatus(data: { status?: { type?: string | undefined } | undefined }): void {
    const raw = data.status?.type;
    const parsed = parseOpenCodeSessionStatus(raw);

    if (parsed === null) {
      const unknownKey = raw === undefined ? 'undefined' : String(raw);
      if (unknownKey !== lastStatus) {
        lastStatus = unknownKey;
        logLine(target, 'status', `unknown_session_status:${unknownKey}`);
      }
      return;
    }

    if (parsed === lastStatus) return;
    lastStatus = parsed;
    logLine(target, 'status', parsed);

    switch (parsed) {
      case 'retry': {
        if (terminalAbortRequested) {
          abortTerminalProviderError();
          return;
        }
        emitActivity('waiting', 'opencode.session.status.retry');
        scheduleRetryIdleTimeout();
        return;
      }
      case 'idle': {
        clearRetryIdleTimeout();
        // OpenCode sometimes emits session.status idle without a separate session.idle
        // event. Without this, nativeTurnPhase never resets and pending tasks stay stuck.
        handleSessionIdle();
        return;
      }
      case 'busy': {
        clearRetryIdleTimeout();
        emitActivity('progress', 'opencode.session.status.busy');
        return;
      }
      default: {
        assertNeverOpenCodeSessionStatus(parsed, 'handleSessionStatus');
      }
    }
  }

  const eventHandlers: Record<string, (data: Record<string, unknown>) => void | Promise<void>> = {
    'session.text.delta': (data) => handleTextDelta(data),
    'session.reasoning.delta': (data) => handleReasoningDelta(data),
    'session.tool.input.started': (data) => {
      handleToolInputStarted(data);
    },
    'session.tool.called': (data) => handleToolCalled(data),
    'session.tool.success': (data) => handleToolTerminal(data, 'completed'),
    'session.tool.failed': (data) => handleToolTerminal(data, 'error'),
    'session.compaction.ended': () => logLine(target, 'compacted'),
    'session.compaction.failed': (data) => handleSessionError(data),
    'session.execution.succeeded': () => handleExecutionSucceeded(),
    'session.execution.failed': (data) => handleExecutionFailed(data),
    'session.execution.interrupted': () => handleExecutionInterrupted(),
    'session.retry.scheduled': (data) => handleRetryScheduled(data),
    'session.idle': () => handleSessionIdle(),
    'session.status': (data) =>
      handleSessionStatus(data as { status?: { type?: string | undefined } | undefined }),
  };

  async function handleEvent(event: OpenCodeEvent): Promise<void> {
    const eventSession = eventSessionId(event);
    if (!shouldProcessEvent(eventSession)) return;

    emitActivity('transport', `opencode.event.${event.type}`);

    if (!sessionStarted) {
      sessionStarted = true;
      logLine(target, 'session] Started', `role: ${options.role}`);
    }

    const handler = eventHandlers[event.type];
    if (handler) {
      await handler(event.data ?? {});
    }
  }

  function shouldProcessEvent(eventSession: string | undefined): boolean {
    if (eventSession) return eventSession === options.sessionId;
    // V2 session-scoped events always carry data.sessionID; anything without one
    // cannot be attributed to this session and is dropped.
    return false;
  }

  async function drainStreamEvents(stream: AsyncIterable<OpenCodeEvent>): Promise<void> {
    const iterator = stream[Symbol.asyncIterator]();
    try {
      while (!cancelled) {
        const next = await iterator.next();
        if (next.done) break;
        await handleEvent(next.value);
      }
    } finally {
      try {
        await iterator.return?.();
      } catch {
        // Ignore iterator cleanup failures.
      }
    }
  }

  async function run() {
    try {
      const stream = client.event.subscribe();
      await drainStreamEvents(stream);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logLine(errorTarget, 'error', message);
      if (isTerminalProviderError(err)) {
        abortTerminalProviderError();
      }
    } finally {
      doneResolve();
    }
  }

  run();

  return {
    stop: () => {
      cancelled = true;
      clearRetryIdleTimeout();
    },
    done: donePromise,
    onAgentEnd: (cb: () => void) => {
      agentEndCallbacks.push(cb);
    },
    onTurnResult: (cb: (result: TurnCompletionResult) => void) => {
      turnResultCallbacks.push(cb);
      if (activeTurnCompletion.value) cb(activeTurnCompletion.value);
    },
    abortTerminalProviderError,
    armTurnEnd,
  };
}
