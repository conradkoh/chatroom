import type { Writable } from 'node:stream';

import {
  assertNeverOpenCodeSessionStatus,
  parseOpenCodeSessionStatus,
} from './opencode-session-status.js';
import { isTerminalProviderError } from '../../../../../domain/usecase/detect-terminal-provider-error.js';
import type {
  HarnessActivityEvent,
  HarnessActivityKind,
} from '../../../../agent-process-manager/harness-activity-emitter.js';
import { appendToolInputToPayload, formatTimestampedLogLine } from '../agent-log-format.js';

export interface SessionEventForwarderOptions {
  sessionId: string;
  role: string;
  target?: Writable | undefined;
  errorTarget?: Writable | undefined;
  now?:( () => string) | undefined;
  /** Human-readable log lines for resume-storm reason classification. */
  onLogLine?:( (line: string) => void) | undefined;
  /** Raw assistant text deltas for missed-handoff delivery. */
  onAssistantText?:( (text: string) => void) | undefined;
  /** Typed harness activity signals for observability and first-progress presence. */
  onActivity?:( (event: HarnessActivityEvent) => void) | undefined;
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

interface OpenCodeEvent {
  type: string;
  properties?: Record<string, unknown> | undefined;
}

/**
 * Minimal client surface needed by the forwarder. Structurally compatible with
 * the real `OpencodeClient.event` subset, plus loose enough that tests can
 * supply a fake without satisfying the full SDK type.
 */
export interface SessionEventForwarderClient {
  event: {
    subscribe: (options?: unknown) => Promise<{ stream: AsyncGenerator<OpenCodeEvent> }>;
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

function eventSessionId(event: OpenCodeEvent): string | undefined {
  const p = event.properties;
  if (!p || typeof p !== 'object') return undefined;

  const direct = sessionIdFromDirect(p);
  if (direct !== undefined) return direct;

  const fromPart = sessionIdFromPart(p);
  if (fromPart !== undefined) return fromPart;

  return sessionIdFromInfoBlock(p);
}

function sessionIdFromDirect(p: Record<string, unknown>): string | undefined {
  if ('sessionID' in p && typeof p.sessionID === 'string') return p.sessionID;
  return undefined;
}

function sessionIdFromPart(p: Record<string, unknown>): string | undefined {
  if ('part' in p && p.part && typeof p.part === 'object') {
    return (p.part as { sessionID?: string | undefined }).sessionID;
  }
  return undefined;
}

function sessionIdFromInfoBlock(p: Record<string, unknown>): string | undefined {
  if ('info' in p && p.info && typeof p.info === 'object') {
    return sessionIdFromInfo(p.info as Record<string, unknown>);
  }
  return undefined;
}

function sessionIdFromInfo(info: Record<string, unknown>): string | undefined {
  const id = info.id;
  if (typeof id === 'string') return id;
  const sid = info.sessionID;
  if (typeof sid === 'string') return sid;
  return undefined;
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
  let agentEndEmitted = false;
  const seenToolStates = new Map<string, string>();
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
        return 'opencode.message.part.updated.text';
      case 'thinking':
        return 'opencode.message.part.updated.reasoning';
      case 'file':
        return 'opencode.file.edited';
      case 'compacted':
        return 'opencode.session.compacted';
      default:
        if (kind.startsWith('tool:')) {
          return 'opencode.message.part.updated.tool';
        }
        return undefined;
    }
  }

  function isAgentActivityKind(kind: string): boolean {
    return (
      kind === 'text' ||
      kind === 'thinking' ||
      kind === 'file' ||
      kind === 'compacted' ||
      kind.startsWith('tool:')
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
      emitAgentEnd();
    }, timeoutMs);
  }

  function emitAgentEnd(reason?: string): void {
    if (agentEndEmitted) return;
    agentEndEmitted = true;
    logLine(target, 'agent_end', reason ? `reason: ${reason}` : undefined);
    for (const cb of agentEndCallbacks) cb();
  }

  function abortTerminalProviderError(): void {
    if (terminalAbortRequested) return;
    terminalAbortRequested = true;
    cancelled = true;
    emitAgentEnd('provider_rate_limit');
  }

  function armTurnEnd(): void {
    if (terminalAbortRequested) {
      logLine(target, 'status', 'turn_arm_blocked_terminal');
      return;
    }
    clearRetryIdleTimeout();
    agentEndEmitted = false;
    lastStatus = undefined;
  }

  function resolvePartContent(
    delta: string | undefined,
    text: string | undefined
  ): string | undefined {
    return delta !== undefined && delta !== '' ? delta : text;
  }

  function resolveToolState(
    props: { state?: string | undefined },
    part: { state?: { status?: string | undefined } | undefined }
  ): string {
    if (typeof props?.state === 'string') return props.state;
    if (typeof part.state?.status === 'string') return part.state.status;
    return 'started';
  }

  function formatCompletedToolPayload(
    part: { state?: { input?: unknown | undefined; time?: { start?: number | undefined; end?: number | undefined } | undefined } | undefined; tool?: string | undefined },
    state: string
  ): string {
    const start = part.state?.time?.start;
    const end = part.state?.time?.end;
    if (state !== 'completed' || start === undefined || end === undefined) {
      return state;
    }
    const duration = ((end - start) / 1000).toFixed(1);
    return `${state} (${duration}s)`;
  }

  async function handleTextPartUpdate(
    props: { delta?: string | undefined },
    part: { text?: string | undefined }
  ): Promise<void> {
    const chunk = resolvePartContent(props?.delta, part.text);
    if (chunk) {
      options.onAssistantText?.(chunk);
      logLine(target, 'text', chunk);
    }
  }

  async function handleReasoningPartUpdate(
    props: { delta?: string | undefined },
    part: { text?: string | undefined }
  ): Promise<void> {
    const chunk = resolvePartContent(props?.delta, part.text);
    if (chunk) logLine(target, 'thinking', chunk);
  }

  async function handlePartUpdated(props: {
    part?: {
      type?: string | undefined;
      tool?: string | undefined;
      text?: string | undefined;
      sessionID?: string | undefined;
      state?: { status?: string | undefined; input?: unknown | undefined; time?: { start?: number | undefined; end?: number | undefined } | undefined } | undefined;
      callID?: string | undefined;
    } | undefined;
    delta?: string | undefined;
    state?: string | undefined;
  }): Promise<void> {
    const part = props.part;
    const partType = part?.type;
    if (!part || !partType) return;

    const dispatch: Record<string, () => Promise<void>> = {
      text: () => handleTextPartUpdate(props, part),
      reasoning: () => handleReasoningPartUpdate(props, part),
      tool: () => (part.tool ? handleToolPart(part, props, seenToolStates) : Promise.resolve()),
    };
    await dispatch[partType]?.();
  }

  async function handleToolPart(
    part: {
      type?: string | undefined;
      tool?: string | undefined;
      state?: { status?: string | undefined; input?: unknown | undefined; time?: { start?: number | undefined; end?: number | undefined } | undefined } | undefined;
      callID?: string | undefined;
    },
    props: { state?: string | undefined },
    toolStates: Map<string, string>
  ): Promise<void> {
    const state = resolveToolState(props, part);

    const payload = buildToolPayload(part, state);
    const callID = part.callID ?? 'unknown';
    const seenKey = `${callID}:${state}`;

    if (!toolStates.has(seenKey)) {
      toolStates.set(seenKey, payload);
      logLine(target, 'tool: ' + (part.tool as string), payload);
    }
    if (state === 'completed' || state === 'error') {
      toolStates.delete(seenKey);
    }
  }

  function buildToolPayload(
    part: { state?: { input?: unknown | undefined; time?: { start?: number | undefined; end?: number | undefined } | undefined } | undefined; tool?: string | undefined },
    state: string
  ): string {
    const basePayload = formatCompletedToolPayload(part, state);
    if (!part.state?.input) return basePayload;
    return appendToolInputToPayload(basePayload, part.state.input, part.tool as string);
  }

  function formatFilePayload(props: {
    file?: string | undefined;
    action?: string | undefined;
    kind?: string | undefined;
  }): string | undefined {
    const { file, action, kind } = props;
    const label = action ?? kind;
    if (!label) return file;
    return `${file} (${label})`;
  }

  async function handleFileEdited(props: {
    file?: string | undefined;
    action?: string | undefined;
    kind?: string | undefined;
  }): Promise<void> {
    logLine(target, 'file', formatFilePayload(props));
  }

  async function handleSessionIdle(): Promise<void> {
    clearRetryIdleTimeout();
    if (terminalAbortRequested) return;
    emitAgentEnd();
  }

  async function handleSessionCompacted(): Promise<void> {
    logLine(target, 'compacted');
  }

  async function handleSessionStatus(props: { status?: { type?: string | undefined } | undefined }): Promise<void> {
    const raw = props?.status?.type;
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
        await handleSessionIdle();
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

  async function handleSessionError(props: {
    error?: { name?: string | undefined; data?: { message?: string | undefined } | undefined } | undefined;
    tool?: string | undefined;
    command?: string | undefined;
  }): Promise<void> {
    emitActivity('failure', 'opencode.session.error');
    const err = props?.error;
    const errMsg = formatErrorName(err);
    const context = formatErrorContext(props);
    const payload = context ? `${errMsg} ${context}` : errMsg;
    logLine(errorTarget, 'error', payload);
    if (isTerminalProviderError(err)) {
      abortTerminalProviderError();
    }
  }

  function formatErrorName(
    err: { name?: string | undefined; data?: { message?: string | undefined } | undefined } | undefined
  ): string {
    if (!err?.name) return String(err ?? 'unknown');
    const detail = err?.data?.message;
    return detail ? `${err.name}: ${detail}` : err.name;
  }

  function formatErrorContext(props: { tool?: string | undefined; command?: string | undefined }): string | undefined {
    if (props?.tool) return `[tool: ${props.tool}]`;
    if (props?.command) return `[command: ${props.command}]`;
    return undefined;
  }

  const eventHandlers: Record<string, (props: Record<string, unknown>) => Promise<void>> = {
    'message.part.updated': (props) =>
      handlePartUpdated(props as Parameters<typeof handlePartUpdated>[0]),
    'file.edited': (props) => handleFileEdited(props as Parameters<typeof handleFileEdited>[0]),
    'session.idle': () => handleSessionIdle(),
    'session.compacted': () => handleSessionCompacted(),
    'session.status': (props) =>
      handleSessionStatus(props as Parameters<typeof handleSessionStatus>[0]),
    'session.error': (props) =>
      handleSessionError(props as Parameters<typeof handleSessionError>[0]),
  };

  const knownEventTypes = new Set(Object.keys(eventHandlers));

  async function handleEvent(event: OpenCodeEvent): Promise<void> {
    const eventSession = eventSessionId(event);
    if (!shouldProcessEvent(event, eventSession)) return;

    emitActivity('transport', `opencode.event.${event.type}`);

    if (!sessionStarted) {
      sessionStarted = true;
      logLine(target, 'session] Started', `role: ${options.role}`);
    }

    const handler = eventHandlers[event.type];
    if (handler) {
      await handler(event.properties ?? {});
    }
  }

  function shouldProcessEvent(event: OpenCodeEvent, eventSession: string | undefined): boolean {
    if (eventSession) return eventSession === options.sessionId;
    return knownEventTypes.has(event.type);
  }

  async function drainStreamEvents(stream: AsyncGenerator<OpenCodeEvent>): Promise<void> {
    for await (const event of stream) {
      if (cancelled) {
        await stream.return?.(undefined);
        break;
      }
      await handleEvent(event);
    }
  }

  async function run() {
    try {
      const result = await client.event.subscribe();
      const stream = result.stream;

      if (cancelled) {
        await stream.return?.(undefined);
        return;
      }

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
    abortTerminalProviderError,
    armTurnEnd,
  };
}
