/**
 * SessionHandleRegistry — shared registry of active harness sessions.
 *
 * Used by both `pending-harness-session-subscription` (which opens sessions)
 * and `pending-prompt-subscription` (which sends prompts) so they share a
 * single session + event sink per harnessSessionRowId.
 *
 * This eliminates the duplicate-sink bug where `processSession` wired a
 * permanent sink and `executePromptTask` wired another per-prompt sink,
 * causing duplicate messages in chatroom_harnessSessionMessages.
 *
 * On daemon shutdown, `closeAll()` flushes and closes all sinks + sessions.
 */

import type { DirectHarnessSession } from '../../../domain/index.js';
import type { BufferedMessageStreamSink } from '../../../infrastructure/services/direct-harness/message-stream/index.js';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface ActiveSessionHandle {
  readonly session: DirectHarnessSession;
  readonly sink: BufferedMessageStreamSink;
  readonly rowId: string;
}

// ─── Registry ────────────────────────────────────────────────────────────────

export class SessionHandleRegistry {
  private readonly handles = new Map<string, ActiveSessionHandle>();

  register(rowId: string, handle: ActiveSessionHandle): void {
    this.handles.set(rowId, handle);
  }

  get(rowId: string): ActiveSessionHandle | undefined {
    return this.handles.get(rowId);
  }

  remove(rowId: string): void {
    this.handles.delete(rowId);
  }

  get size(): number {
    return this.handles.size;
  }

  /** Close all sinks and sessions. Called on daemon shutdown. */
  async closeAll(): Promise<void> {
    const closes = [...this.handles.values()].map(async (h) => {
      try {
        await h.sink.close();
      } catch {
        // Best-effort flush on shutdown — swallow transport errors
      }
      try {
        await h.session.close();
      } catch {
        // Session may already be dead
      }
    });
    await Promise.all(closes);
    this.handles.clear();
  }
}
