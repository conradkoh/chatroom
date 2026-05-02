/**
 * DirectHarnessSession implementation for the opencode-sdk harness.
 *
 * Wraps an opencode SDK client session, providing send/onEvent/close
 * as specified by the DirectHarnessSession domain interface.
 */

import type {
  DirectHarnessSession,
  DirectHarnessSessionEvent,
  HarnessSessionId,
  PromptInput,
} from '../../../domain/direct-harness/index.js';

/**
 * Minimal client surface needed by the session.
 * Structurally compatible with the OpencodeClient from @opencode-ai/sdk.
 * Using a minimal interface (like SessionEventForwarderClient does) so
 * tests can inject plain mocks without satisfying the full SDK type.
 */
export interface OpencodeSdkSessionClient {
  session: {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    create(args: any): Promise<any>;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    promptAsync(args: any): Promise<any>;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    abort(args: any): Promise<any>;
  };
  event: {
     
    subscribe(
      args?: any
    ): Promise<{ stream: AsyncGenerator<{ type: string; properties?: Record<string, unknown> }> }>;
  };
  app: {
    /** Returns the list of agents configured in this opencode server instance. */
    agents(): Promise<{
      data?: {
        name: string;
        mode: 'subagent' | 'primary' | 'all';
        model?: { providerID: string; modelID: string };
        description?: string;
      }[];
    }>;
  };
  config: {
    /** Returns providers and their models from the opencode server's active config. */
    providers(): Promise<{
      data?: {
        providers: {
          id: string;
          name: string;
          models: Record<string, { id: string; name: string }>;
        }[];
      };
    }>;
  };
}

/**
 * Manages a single opencode-sdk session lifecycle.
 * Created by `createBoundOpencodeSdkHarness().openSession()` or `resumeSessionFromStore()`.
 */
export class OpencodeSdkDirectHarnessSession implements DirectHarnessSession {
  private closed = false;
  private readonly listeners = new Set<(e: DirectHarnessSessionEvent) => void>();

  constructor(
    public readonly harnessSessionId: HarnessSessionId,
    private readonly client: OpencodeSdkSessionClient,
    /** Abort the ongoing event subscription loop. */
    private readonly stopEventStream: () => void,
    /** Kill the child process on close (undefined for resumed sessions). */
    private readonly killProcess?: () => void
  ) {}

  // ── DirectHarnessSession ─────────────────────────────────────────────────

  async prompt(input: PromptInput): Promise<void> {
    if (this.closed) throw new Error('Session is closed');
    if (!input.agent || input.agent.trim() === '') {
      throw new Error('PromptInput.agent is required and must not be empty');
    }
    await this.client.session.promptAsync({
      path: { id: this.harnessSessionId as string },
      body: {
        parts: input.parts.map((p) => ({ type: p.type, text: p.text })),
        agent: input.agent,
        ...(input.model !== undefined ? { model: input.model } : {}),
        ...(input.system !== undefined ? { system: input.system } : {}),
        ...(input.tools !== undefined ? { tools: input.tools } : {}),
      },
    });
  }

  onEvent(listener: (e: DirectHarnessSessionEvent) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;

    this.stopEventStream();

    try {
      await this.client.session.abort({ path: { id: this.harnessSessionId as string } });
    } catch {
      // Ignore abort failures — process may already be dead
    }

    this.killProcess?.();
  }

  // ── Internal ─────────────────────────────────────────────────────────────

  /** Emit an SDK event to all registered onEvent listeners. */
  _emit(type: string, properties: Record<string, unknown> | undefined, timestamp: number): void {
    const event: DirectHarnessSessionEvent = { type, payload: properties ?? {}, timestamp };
    for (const listener of this.listeners) {
      listener(event);
    }
  }
}

/**
 * Subscribe to the SDK event stream and forward events to the session.
 * Returns a stop() function. The loop runs until stopped or the stream ends.
 * The subscription is started asynchronously in the background.
 */
export function subscribeToSessionEvents(
  client: OpencodeSdkSessionClient,
  session: OpencodeSdkDirectHarnessSession,
  now: () => number = Date.now
): () => void {
  let stopped = false;

  void (async () => {
    try {
      const { stream } = await client.event.subscribe();
      for await (const event of stream) {
        if (stopped) break;
        session._emit(event.type, event.properties, now());
      }
    } catch {
      // Ignore errors — stream ended or was aborted
    }
  })();

  return () => {
    stopped = true;
  };
}
