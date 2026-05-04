/**
 * ProcessEventBus — one shared SSE subscription per opencode server process,
 * with session-aware event routing.
 *
 * Problem it solves
 * ─────────────────
 * The opencode SDK's `/event` SSE endpoint streams events for ALL sessions on
 * a given server process. Previously every DirectHarnessSession called
 * `client.event.subscribe()` independently, creating N redundant connections
 * all receiving the same firehose — and each connection had to be filtered
 * individually.
 *
 * Solution
 * ────────
 * ProcessEventBus opens exactly ONE SSE connection per process. When an event
 * arrives it extracts the opencode sessionID and routes the event to the
 * handler registered for that session. Workspace-level events (no sessionID:
 * file.edited, vcs.branch.updated, etc.) are broadcast to all registered
 * handlers since they cannot be attributed to a specific session.
 *
 * Sessions register via `bus.register(sdkSessionId, handler)` and get back an
 * unregister function to call on close. The bus itself is stopped when the
 * opencode server process is killed.
 */

// ─── Minimal client interface ─────────────────────────────────────────────────

/**
 * The subset of the opencode SDK client that ProcessEventBus needs.
 * Structurally compatible with OpencodeClient and OpencodeSdkSessionClient
 * so no import from session.ts is required (avoids circular dependency).
 */
export interface EventSubscribableClient {
  event: {
    subscribe(
      args?: unknown
    ): Promise<{ stream: AsyncGenerator<{ type: string; properties?: Record<string, unknown> }> }>;
  };
}

// ─── Session ID extraction ────────────────────────────────────────────────────

/**
 * Extract the opencode sessionID from an SSE event's properties, if present.
 *
 * Handles the three places the SDK embeds the session identifier:
 *   - `properties.sessionID`        — most session-scoped events
 *   - `properties.part.sessionID`   — message.part.updated (every Part variant)
 *   - `properties.info.id`          — session.created/updated/deleted (Session type uses `id`)
 *
 * Returns `undefined` for workspace-level events (file.edited, vcs.branch.updated, etc.)
 * that carry no session identifier and should be broadcast to all sessions.
 *
 * This is the canonical implementation. `session.ts:extractEventSessionId` re-exports
 * the same logic; both should be kept in sync if the SDK event shape changes.
 */
export function extractEventSessionId(event: {
  properties?: Record<string, unknown>;
}): string | undefined {
  const p = event.properties;
  if (!p || typeof p !== 'object') return undefined;
  // Most session events: sessionID at the top level
  if ('sessionID' in p && typeof p.sessionID === 'string') return p.sessionID;
  // message.part.updated: sessionID is inside the Part object
  if ('part' in p && p.part && typeof p.part === 'object') {
    return (p.part as { sessionID?: string }).sessionID;
  }
  // session.created/updated/deleted: the Session object uses `id`, not `sessionID`
  if ('info' in p && p.info && typeof p.info === 'object') {
    const info = p.info as { id?: string; sessionID?: string };
    return info.id ?? info.sessionID;
  }
  return undefined;
}

// ─── Handler type ─────────────────────────────────────────────────────────────

export type ProcessEventHandler = (
  type: string,
  properties: Record<string, unknown> | undefined,
  timestamp: number
) => void;

// ─── ProcessEventBus ──────────────────────────────────────────────────────────

export class ProcessEventBus {
  private readonly handlers = new Map<string, ProcessEventHandler>();
  private stopped = false;

  constructor(client: EventSubscribableClient, now: () => number = Date.now) {
    void this.run(client, now);
  }

  private async run(client: EventSubscribableClient, now: () => number): Promise<void> {
    try {
      const { stream } = await client.event.subscribe();
      for await (const event of stream) {
        if (this.stopped) break;
        const sessionId = extractEventSessionId(event);
        if (sessionId !== undefined) {
          // Route to the specific session that owns this event
          this.handlers.get(sessionId)?.(event.type, event.properties, now());
        } else {
          // Workspace-level event — broadcast to all registered sessions
          for (const handler of this.handlers.values()) {
            handler(event.type, event.properties, now());
          }
        }
      }
    } catch {
      // Ignore — stream ended or the process was killed
    }
  }

  /**
   * Register an event handler for a specific SDK session ID.
   * Returns an unregister function — call it when the session is closed.
   */
  register(sdkSessionId: string, handler: ProcessEventHandler): () => void {
    this.handlers.set(sdkSessionId, handler);
    return () => {
      this.handlers.delete(sdkSessionId);
    };
  }

  /**
   * Stop the shared SSE loop. Call when the opencode server process is killed.
   * After this point no further events are dispatched.
   */
  stop(): void {
    this.stopped = true;
  }
}
