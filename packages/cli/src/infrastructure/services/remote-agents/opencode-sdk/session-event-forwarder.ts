import type { Writable } from 'node:stream';

export interface SessionEventForwarderOptions {
  sessionId: string;
  role: string;
  target?: Writable;
  errorTarget?: Writable;
  now?: () => string;
  /** Human-readable log lines for resume-storm reason classification. */
  onLogLine?: (line: string) => void;
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
  const ts = options.now ? options.now() : new Date().toISOString();
  return `[${ts}] role:${options.role} ${kind}]${payload ? ` ${payload}` : ''}`;
}

function writeLogLine(
  target: Writable,
  options: SessionEventForwarderOptions,
  kind: string,
  payload?: string
): void {
  const line = formatLogLine(options, kind, payload);
  target.write(`${line}\n`);
  options.onLogLine?.(line);
}

/**
 * Detects fatal provider usage/rate-limit errors. OpenCode does NOT emit session.idle
 * after such an error, so the agent would otherwise hang forever waiting for its
 * turn to end. We treat these as a turn end and fire agent_end. Loose shape: the
 * error name/type and message can arrive under different keys across SDK versions.
 */
function isTerminalProviderError(error: unknown): boolean {
  if (!error || typeof error !== 'object') {
    if (typeof error === 'string') {
      return matchesTerminalProviderErrorText(error);
    }
    return false;
  }
  const e = error as {
    name?: unknown;
    type?: unknown;
    message?: unknown;
    data?: { message?: unknown };
    responseBody?: unknown;
  };
  const name = String(e.name ?? e.type ?? '').toLowerCase();
  const message = String(e.data?.message ?? e.message ?? e.responseBody ?? '').toLowerCase();
  const blob = `${name}\n${message}`;
  return matchesTerminalProviderErrorText(blob);
}

function matchesTerminalProviderErrorText(blob: string): boolean {
  const text = blob.toLowerCase();
  return (
    text.includes('usagelimit') ||
    text.includes('usage limit') ||
    text.includes('enable usage from your available balance') ||
    text.includes('rate limit') ||
    text.includes('ratelimit') ||
    text.includes('too many requests') ||
    text.includes('x-ratelimit-exceeded') ||
    text.includes('weekly rate limit') ||
    text.includes('exceeded your weekly')
  );
}

function eventSessionId(event: OpenCodeEvent): string | undefined {
  const p = event.properties;
  if (!p || typeof p !== 'object') return undefined;
  if ('sessionID' in p && typeof p.sessionID === 'string') return p.sessionID;
  if ('part' in p && p.part && typeof p.part === 'object') {
    return (p.part as { sessionID?: string }).sessionID;
  }
  if ('info' in p && p.info && typeof p.info === 'object') {
    // session.created / session.updated / session.deleted carry a Session object
    // in properties.info. The Session type uses `id` as its identifier, not `sessionID`.
    const info = p.info as { id?: string; sessionID?: string };
    return info.id ?? info.sessionID;
  }
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
  const seenToolStates = new Map<string, string>();

  // Deduplication: track last logged status to avoid duplicate status lines
  let lastStatus: string | undefined;

  // Callbacks registered via onAgentEnd()
  const agentEndCallbacks: (() => void)[] = [];

  const donePromise = new Promise<void>((resolve) => {
    doneResolve = resolve;
  });

  async function run() {
    try {
      const result = await client.event.subscribe();
      const stream = result.stream;

      if (cancelled) {
        await stream.return?.(undefined);
        return;
      }

      for await (const event of stream) {
        if (cancelled) {
          await stream.return?.(undefined);
          break;
        }

        const eventSession = eventSessionId(event);
        if (eventSession && eventSession !== options.sessionId) continue;
        if (
          eventSession === undefined &&
          event.type !== 'message.part.updated' &&
          event.type !== 'session.idle' &&
          event.type !== 'session.compacted' &&
          event.type !== 'session.error' &&
          event.type !== 'session.status' &&
          event.type !== 'file.edited'
        )
          continue;

        if (!sessionStarted) {
          sessionStarted = true;
          writeLogLine(target, options, 'session] Started', `role: ${options.role}`);
        }

        switch (event.type) {
          case 'message.part.updated': {
            // OpenCode SDK: EventMessagePartUpdated is { part: Part; delta?: string }.
            // TextPart / ReasoningPart use `text`; streaming deltas live on properties.delta
            // (see @opencode-ai/sdk types). Do not read part.delta — it is not on Part.
            const props = event.properties as
              | {
                  part?: {
                    type?: string;
                    tool?: string;
                    text?: string;
                    sessionID?: string;
                    state?: {
                      status?: string;
                      input?: unknown;
                      time?: { start?: number; end?: number };
                    };
                  };
                  delta?: string;
                  state?: string;
                }
              | undefined;
            const part = props?.part;
            if (part?.type === 'text') {
              const chunk =
                props?.delta !== undefined && props.delta !== '' ? props.delta : part.text;
              if (chunk) {
                writeLogLine(target, options, 'text', chunk);
              }
            } else if (part?.type === 'reasoning') {
              const chunk =
                props?.delta !== undefined && props.delta !== '' ? props.delta : part.text;
              if (chunk) {
                writeLogLine(target, options, 'thinking', chunk);
              }
            } else if (part?.type === 'tool' && part.tool) {
              const state =
                typeof props?.state === 'string'
                  ? props.state
                  : typeof part.state?.status === 'string'
                    ? part.state.status
                    : 'started';

              function appendInput(base: string, input: unknown, tool: string): string {
                if (
                  !input ||
                  (typeof input === 'object' && Object.keys(input as object).length === 0)
                ) {
                  return base;
                }
                const inp = input as Record<string, unknown>;
                if (tool === 'bash' && typeof inp.command === 'string') {
                  return `${base}: ${inp.command}`;
                }
                const inputStr = typeof inp === 'string' ? inp : JSON.stringify(inp);
                return `${base}: ${inputStr}`;
              }

              let payload = state;
              if (part.state?.input) {
                payload = appendInput(payload, part.state.input, part.tool);
              }

              if (
                state === 'completed' &&
                part.state?.time?.start !== undefined &&
                part.state?.time?.end !== undefined
              ) {
                const duration = ((part.state.time.end - part.state.time.start) / 1000).toFixed(1);
                payload = appendInput(`${state} (${duration}s)`, part.state.input, part.tool);
              }

              const callID = (part as { callID?: string }).callID ?? 'unknown';
              const seenKey = `${callID}:${state}`;
              if (!seenToolStates.has(seenKey)) {
                seenToolStates.set(seenKey, payload);
                writeLogLine(target, options, 'tool: ' + part.tool, payload);
              }
              if (state === 'completed' || state === 'error') {
                seenToolStates.delete(seenKey);
              }
            }
            break;
          }
          case 'file.edited': {
            const props = event.properties as
              | { file?: string; action?: string; kind?: string }
              | undefined;
            const kind = props?.action ?? props?.kind;
            const filePayload = kind ? `${props?.file} (${kind})` : props?.file;
            writeLogLine(target, options, 'file', filePayload);
            break;
          }
          case 'session.idle': {
            writeLogLine(target, options, 'agent_end');
            for (const cb of agentEndCallbacks) cb();
            break;
          }
          case 'session.compacted': {
            writeLogLine(target, options, 'compacted');
            break;
          }
          case 'session.status': {
            const props = event.properties as { status?: { type?: string } } | undefined;
            const currentStatus = props?.status?.type;
            if (currentStatus !== lastStatus) {
              lastStatus = currentStatus;
              writeLogLine(target, options, 'status', currentStatus);
            }
            break;
          }
          case 'session.error': {
            const props = event.properties as
              | {
                  error?: { name?: string; data?: { message?: string } };
                  tool?: string;
                  command?: string;
                }
              | undefined;
            const err = props?.error;
            const errMsg = err?.name
              ? `${err.name}${err?.data?.message ? ': ' + err.data.message : ''}`
              : String(err ?? 'unknown');
            let payload = errMsg;
            if (props?.tool) {
              payload += ` [tool: ${props.tool}]`;
            } else if (props?.command) {
              payload += ` [command: ${props.command}]`;
            }
            writeLogLine(errorTarget, options, 'error', payload);
            // Usage-limit and rate-limit errors are terminal: OpenCode will not emit session.idle,
            // so end the turn ourselves to avoid a hung agent.
            if (isTerminalProviderError(err)) {
              writeLogLine(target, options, 'agent_end', 'reason: provider_rate_limit');
              for (const cb of agentEndCallbacks) cb();
            }
            break;
          }
          default:
            break;
        }
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      writeLogLine(errorTarget, options, 'error', message);
      if (isTerminalProviderError(err)) {
        writeLogLine(target, options, 'agent_end', 'reason: provider_rate_limit');
        for (const cb of agentEndCallbacks) cb();
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
  };
}
