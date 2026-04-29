import { Writable } from 'node:stream';

export interface SessionEventForwarderOptions {
  sessionId: string;
  role: string;
  target?: Writable;
  errorTarget?: Writable;
  now?: () => string;
}

export interface SessionEventForwarderHandle {
  stop(): void;
  done: Promise<void>;
}

export interface OpenCodeEvent {
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

function eventSessionId(event: OpenCodeEvent): string | undefined {
  const p = event.properties;
  if (!p || typeof p !== 'object') return undefined;
  if ('sessionID' in p && typeof p.sessionID === 'string') return p.sessionID;
  if ('part' in p && p.part && typeof p.part === 'object') {
    return (p.part as { sessionID?: string }).sessionID;
  }
  if ('info' in p && p.info && typeof p.info === 'object') {
    return (p.info as { sessionID?: string }).sessionID;
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
                    state?: { status?: string };
                  };
                  delta?: string;
                  state?: string;
                }
              | undefined;
            const part = props?.part;
            if (part?.type === 'text') {
              const chunk =
                props?.delta !== undefined && props.delta !== ''
                  ? props.delta
                  : part.text;
              if (chunk) {
                target.write(formatLogLine(options, 'text', chunk) + '\n');
              }
            } else if (part?.type === 'reasoning') {
              const chunk =
                props?.delta !== undefined && props.delta !== ''
                  ? props.delta
                  : part.text;
              if (chunk) {
                target.write(formatLogLine(options, 'thinking', chunk) + '\n');
              }
            } else if (part?.type === 'tool' && part.tool) {
              const state =
                typeof props?.state === 'string'
                  ? props.state
                  : typeof part.state?.status === 'string'
                    ? part.state.status
                    : 'started';
              target.write(formatLogLine(options, 'tool: ' + part.tool, state) + '\n');
            }
            break;
          }
          case 'file.edited': {
            const props = event.properties as { file?: string } | undefined;
            target.write(formatLogLine(options, 'file', props?.file) + '\n');
            break;
          }
          case 'session.idle': {
            target.write(formatLogLine(options, 'agent_end') + '\n');
            break;
          }
          case 'session.compacted': {
            target.write(formatLogLine(options, 'compacted') + '\n');
            break;
          }
          case 'session.status': {
            const props = event.properties as { status?: { type?: string } } | undefined;
            target.write(formatLogLine(options, 'status', props?.status?.type) + '\n');
            break;
          }
          case 'session.error': {
            const props = event.properties as
              | { error?: { name?: string; data?: { message?: string } } }
              | undefined;
            const err = props?.error;
            const errMsg = err?.name
              ? `${err.name}${err?.data?.message ? ': ' + err.data.message : ''}`
              : String(err ?? 'unknown');
            errorTarget.write(formatLogLine(options, 'error', errMsg) + '\n');
            break;
          }
          default:
            break;
        }
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      errorTarget.write(formatLogLine(options, 'error', message) + '\n');
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
  };
}
