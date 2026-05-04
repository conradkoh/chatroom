/**
 * HarnessReplicationBus — domain interface for event-driven harness↔backend
 * communication.
 *
 * Design principles (SOLID):
 * ──────────────────────────
 * Single Responsibility: The bus ONLY transports events. Persistence and
 *   dispatch are handled by separate subscribers (Reactor, Dispatcher).
 *
 * Open/Closed: New event types are added as unions without changing the bus
 *   interface.
 *
 * Liskov Substitution: InMemoryBusImpl, RedisBusImpl, etc. all satisfy the
 *   same interface and can be swapped without changing consumers.
 *
 * Interface Segregation: Subscribers filter by event type — they only receive
 *   events they care about.
 *
 * Dependency Inversion: The domain (harness, reactor, dispatcher) depends on
 *   the HarnessReplicationBus interface, not on any concrete backend or
 *   transport implementation.
 *
 * Usage:
 * ─────
 *   const bus = new InMemoryHarnessReplicationBus();
 *
 *   // Outbound: harness events → backend
 *   const reactor = new HarnessReactor({ backend, bus });
 *   reactor.start();
 *
 *   // Inbound: user messages → harness
 *   const dispatcher = new HarnessDispatcher({ bus, getSession });
 *   dispatcher.start();
 *
 *   // Wire a session to publish to the bus
 *   wireSessionToBus(session, bus, harnessSessionRowId);
 */

import type {
  HarnessSessionId,
  HarnessSessionRowId,
} from '../entities/harness-session.js';
import type { PromptPart } from '../entities/direct-harness-session.js';

// ─── Event types ──────────────────────────────────────────────────────────────

export type HarnessReplicationEvent =
  | TitleChangedEvent
  | MessageChunkEvent
  | UserMessageEvent;

/** Emitted when the harness updates a session's title (auto-generation, TUI edit). */
export interface TitleChangedEvent {
  readonly type: 'titleChanged';
  /** Backend row identifier for this session. */
  readonly harnessSessionRowId: HarnessSessionRowId;
  /** Harness-issued session identifier. */
  readonly harnessSessionId: HarnessSessionId;
  /** The new title. */
  readonly newTitle: string;
  /** Monotonic timestamp (ms). */
  readonly timestamp: number;
}

/** Emitted when the harness produces a text chunk (streaming response). */
export interface MessageChunkEvent {
  readonly type: 'messageChunk';
  readonly harnessSessionRowId: HarnessSessionRowId;
  readonly harnessSessionId: HarnessSessionId;
  /** The text content for this chunk. */
  readonly content: string;
  /** Monotonic timestamp (ms). */
  readonly timestamp: number;
  /**
   * Sequence number assigned by the consumer (sink/reactor), not the producer.
   * The producer leaves this undefined; the reactor assigns monotonic seqs.
   */
  seq?: number;
}

/** Emitted when a user submits a message to be sent to the harness. */
export interface UserMessageEvent {
  readonly type: 'userMessage';
  readonly harnessSessionRowId: HarnessSessionRowId;
  readonly harnessSessionId: HarnessSessionId;
  /** Content parts of the user's message. */
  readonly parts: readonly PromptPart[];
  /** Agent to use for this turn. */
  readonly agent: string;
  /** Optional model override. */
  readonly model?: { readonly providerID: string; readonly modelID: string };
  /** Optional system prompt override. */
  readonly system?: string;
  /** Monotonic timestamp (ms). */
  readonly timestamp: number;
}

// ─── Filter ───────────────────────────────────────────────────────────────────

/**
 * Event filter for subscriptions.
 * All fields are ANDed together. If a field is omitted, it matches any value.
 */
export interface HarnessEventFilter {
  /** Match events of this type. */
  readonly type?: HarnessReplicationEvent['type'];
  /** Match events for this backend session row. */
  readonly harnessSessionRowId?: HarnessSessionRowId;
}

// ─── Handler ──────────────────────────────────────────────────────────────────

export type HarnessEventHandler<T extends HarnessReplicationEvent = HarnessReplicationEvent> = (
  event: T
) => void | Promise<void>;

// ─── Bus interface ────────────────────────────────────────────────────────────

export interface HarnessReplicationBus {
  /**
   * Publish an event to the bus.
   *
   * Fire-and-forget. The bus delivers to all matching subscribers
   * asynchronously. Errors in individual subscribers are isolated and do not
   * affect other subscribers or the publisher.
   */
  publish(event: HarnessReplicationEvent): void;

  /**
   * Subscribe to events matching the filter.
   *
   * Returns an unsubscribe function. Subscribers receive events in the order
   * they were published for a given session.
   */
  subscribe<T extends HarnessReplicationEvent>(
    filter: HarnessEventFilter,
    handler: HarnessEventHandler<T>
  ): () => void;

  /**
   * Gracefully shut down the bus.
   *
   * After this call, publish() is a no-op and no further events are delivered.
   */
  close(): Promise<void>;
}
