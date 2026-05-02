/**
 * Convex-backed MessageStreamTransport for the direct-harness feature.
 *
 * Bridges BufferedMessageStreamSink → chatroom/directHarness/messages:appendMessages.
 * Failures propagate as rejected promises so the sink can apply its
 * retry + warning behavior.
 */

import { api } from '../../../../api.js';
import type { HarnessSessionRowId } from '../../../../domain/direct-harness/harness-session.js';
import type {
  MessageStreamChunk,
  MessageStreamTransport,
} from '../../../../domain/direct-harness/message-stream/index.js';

/** Minimal backend interface — matches BackendOps and DaemonContext.deps.backend. */
export interface ConvexMessageStreamTransportBackend {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  mutation: (endpoint: any, args: any) => Promise<any>;
}

/** Construction options for ConvexMessageStreamTransport. */
export interface ConvexMessageStreamTransportOptions {
  /** The authenticated backend client (e.g. DaemonContext.deps.backend). */
  readonly backend: ConvexMessageStreamTransportBackend;
  /** CLI session identifier — passed verbatim to the mutation. */
  readonly sessionId: string;
}

/**
 * Forwards chunk batches to the backend appendMessages mutation.
 *
 * Empty arrays are short-circuited without calling the backend.
 * All other inputs are forwarded verbatim; no defensive try/catch is applied
 * here — rejected promises propagate to the caller (BufferedMessageStreamSink).
 */
export class ConvexMessageStreamTransport implements MessageStreamTransport {
  constructor(private readonly options: ConvexMessageStreamTransportOptions) {}

  async persist(harnessSessionRowId: HarnessSessionRowId, chunks: readonly MessageStreamChunk[]): Promise<void> {
    if (chunks.length === 0) return;

    // Typed access to the nested module — Convex generates dotted paths
    // for files in subdirectories (mirrors api.integrations.telegram.actions etc).
    const appendMessages = api.chatroom.directHarness.messages.appendMessages;

    await this.options.backend.mutation(appendMessages, {
      sessionId: this.options.sessionId,
      // HarnessSessionRowId is a branded string; Convex Id types are structurally strings at runtime
      harnessSessionRowId: harnessSessionRowId as unknown as string,
      chunks: chunks.map((c) => ({
        seq: c.seq,
        content: c.content,
        timestamp: c.timestamp,
      })),
    });
  }
}
