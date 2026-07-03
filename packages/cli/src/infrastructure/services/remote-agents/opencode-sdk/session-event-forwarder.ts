import type { Writable } from 'node:stream';

import {
  isTerminalProviderError,
  isTerminalProviderFailureInLogs,
} from '../../../../domain/agent-lifecycle/policies/terminal-provider-error.js';
import { appendToolInputToPayload, formatTimestampedLogLine } from '../agent-log-format.js';

export interface SessionEventForwarderOptions {
  sessionId: string;
  role: string;
  target?: Writable;
  errorTarget?: Writable;
  now?: () => string;
  /** Human-readable log lines for resume-storm reason classification. */
  onLogLine?: (line: string) => void;
  /** Raw assistant text deltas for missed-handoff delivery. */
  onAssistantText?: (text: string) => void;
  /** Fires on agent token/tool activity (drives task.in_progress via updateTokenActivity). */
  onActivity?: () => void;
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
}

interface OpenCodeEvent {
  type: string;
  properties?: Record<string, unknown>;
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
    return (p.part as { sessionID?: string }).sessionID;
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
  const seenToolStates = new Map<string, string>();
  let lastStatus: string | undefined;
  const agentEndCallbacks: (() => void)[] = [];
  const recentLogLines: string[] = [];

  const donePromise = new Promise<void>((resolve) => {
    doneResolve = resolve;
  });

  function recordRecentLogLine(line: string): void {
    recentLogLines.push(line);
    if (recentLogLines.length > RECENT_LOG_LINE_CAP) {
      recentLogLines.shift();
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
    targetStream.write(`${line}\n`);
    options.onLogLine?.(line);
    recordRecentLogLine(line);
    if (isAgentActivityKind(kind)) {
      options.onActivity?.();
    }
  }

  function emitAgentEnd(reason?: string): void {
    logLine(target, 'agent_end', reason ? `reason: ${reason}` : undefined);
    for (const cb of agentEndCallbacks) cb();
  }

  function abortTerminalProviderError(): void {
    if (terminalAbortRequested) return;
    terminalAbortRequested = true;
    cancelled = true;
    emitAgentEnd('provider_rate_limit');
  }

  function resolvePartContent(
    delta: string | undefined,
    text: string | undefined
  ): string | undefined {
    return delta !== undefined && delta !== '' ? delta : text;
  }

  function resolveToolState(
    props: { state?: string },
    part: { state?: { status?: string } }
  ): string {
    if (typeof props?.state === 'string') return props.state;
    if (typeof part.state?.status === 'string') return part.state.status;
    return 'started';
  }

  function formatCompletedToolPayload(
    part: { state?: { input?: unknown; time?: { start?: number; end?: number } }; tool?: string },
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
    props: { delta?: string },
    part: { text?: string }
  ): Promise<void> {
    const chunk = resolvePartContent(props?.delta, part.text);
    if (chunk) {
      options.onAssistantText?.(chunk);
      logLine(target, 'text', chunk);
    }
  }

  async function handleReasoningPartUpdate(
    props: { delta?: string },
    part: { text?: string }
  ): Promise<void> {
    const chunk = resolvePartContent(props?.delta, part.text);
    if (chunk) logLine(target, 'thinking', chunk);
  }

  async function handleToolPartUpdate(
    part: {
      type?: string;
      tool?: string;
      state?: { status?: string; input?: unknown; time?: { start?: number; end?: number } };
      callID?: string;
    },
    props: { state?: string },
    toolStates: Map<string, string>
  ): Promise<void> {
    if (!part.tool) return;
    await handleToolPart(part, props, toolStates);
  }

  async function handlePartUpdated(props: {
    part?: {
      type?: string;
      tool?: string;
      text?: string;
      sessionID?: string;
      state?: { status?: string; input?: unknown; time?: { start?: number; end?: number } };
      callID?: string;
    };
    delta?: string;
    state?: string;
  }): Promise<void> {
    const part = props.part;
    const partType = part?.type;
    if (!part || !partType) return;

    const dispatch: Record<string, () => Promise<void>> = {
      text: () => handleTextPartUpdate(props, part),
      reasoning: () => handleReasoningPartUpdate(props, part),
      tool: () => handleToolPartUpdate(part, props, seenToolStates),
    };
    await dispatch[partType]?.();
  }

  async function handleToolPart(
    part: {
      type?: string;
      tool?: string;
      state?: { status?: string; input?: unknown; time?: { start?: number; end?: number } };
      callID?: string;
    },
    props: { state?: string },
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
    part: { state?: { input?: unknown; time?: { start?: number; end?: number } }; tool?: string },
    state: string
  ): string {
    const basePayload = formatCompletedToolPayload(part, state);
    if (!part.state?.input) return basePayload;
    return appendToolInputToPayload(basePayload, part.state.input, part.tool as string);
  }

  function formatFilePayload(props: {
    file?: string;
    action?: string;
    kind?: string;
  }): string | undefined {
    const { file, action, kind } = props;
    const label = action ?? kind;
    if (!label) return file;
    return `${file} (${label})`;
  }

  async function handleFileEdited(props: {
    file?: string;
    action?: string;
    kind?: string;
  }): Promise<void> {
    logLine(target, 'file', formatFilePayload(props));
  }

  async function handleSessionIdle(): Promise<void> {
    if (terminalAbortRequested) return;
    emitAgentEnd();
  }

  async function handleSessionCompacted(): Promise<void> {
    logLine(target, 'compacted');
  }

  async function handleSessionStatus(props: { status?: { type?: string } }): Promise<void> {
    const currentStatus = props?.status?.type;
    if (currentStatus !== lastStatus) {
      lastStatus = currentStatus;
      logLine(target, 'status', currentStatus);
      if (
        currentStatus === 'retry' &&
        (terminalAbortRequested || isTerminalProviderFailureInLogs(recentLogLines))
      ) {
        abortTerminalProviderError();
      }
    }
  }

  async function handleSessionError(props: {
    error?: { name?: string; data?: { message?: string } };
    tool?: string;
    command?: string;
  }): Promise<void> {
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
    err: { name?: string; data?: { message?: string } } | undefined
  ): string {
    if (!err?.name) return String(err ?? 'unknown');
    const detail = err?.data?.message;
    return detail ? `${err.name}: ${detail}` : err.name;
  }

  function formatErrorContext(props: { tool?: string; command?: string }): string | undefined {
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
    },
    done: donePromise,
    onAgentEnd: (cb: () => void) => {
      agentEndCallbacks.push(cb);
    },
    abortTerminalProviderError,
  };
}
