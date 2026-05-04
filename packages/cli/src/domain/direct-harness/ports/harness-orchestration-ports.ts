/**
 * Ports for the use case / application layer to orchestrate harness sessions in a
 * harness-agnostic way: user turns in, normalized replication events out.
 *
 * Concrete harness packages (opencode-sdk, …) implement adapters that bridge
 * raw `DirectHarnessSessionEvent` streams into `HarnessReplicationEvent` where
 * needed; use cases depend only on these ports + `BoundHarness` / `DirectHarnessSession`.
 */

import type { DirectHarnessSession } from '../entities/direct-harness-session.js';
import type { HarnessSessionId } from '../entities/harness-session.js';
import type {
  HarnessEventFilter,
  HarnessEventHandler,
  HarnessReplicationBus,
  HarnessReplicationEvent,
  UserMessageEvent,
} from './replication-bus.js';

// ─── User turn payload ────────────────────────────────────────────────────────

/**
 * User-authored turn destined for the harness. Maps 1:1 to a `userMessage`
 * replication event (the port adds `type` and default `timestamp`).
 */
export type HarnessUserTurnPayload = Omit<UserMessageEvent, 'type' | 'timestamp'> & {
  readonly timestamp?: number;
};

// ─── Fine-grained ports (compose or implement separately) ─────────────────────

/** Publish user turns onto the orchestration channel (typically the replication bus). */
export interface HarnessUserTurnIngressPort {
  publishUserTurn(turn: Readonly<HarnessUserTurnPayload>): void;
}

/** Subscribe to normalized harness ↔ coordinator events. */
export interface HarnessReplicationSubscriptionPort {
  subscribe<T extends HarnessReplicationEvent>(
    filter: HarnessEventFilter,
    handler: HarnessEventHandler<T>
  ): () => void;
}

/**
 * Emit normalized replication events (message chunks, title changes, user
 * messages for fan-in, etc.). Harness-side adapters and tests use this; the use
 * case layer usually does not.
 */
export interface HarnessReplicationEmitPort {
  publish(event: HarnessReplicationEvent): void;
}

/**
 * Resolve a live session handle for dispatch (e.g. `HarnessDispatcher` calling
 * `session.prompt` after a `userMessage` event).
 */
export interface HarnessSessionResolverPort {
  getSession(harnessSessionId: HarnessSessionId): DirectHarnessSession | undefined;
}

// ─── Facades ──────────────────────────────────────────────────────────────────

/**
 * Primary port for use cases: submit user work and observe replication traffic
 * without calling raw `publish({ type: 'userMessage', … })` or depending on a
 * concrete bus class.
 */
export interface HarnessUseCaseOrchestrationPort
  extends HarnessUserTurnIngressPort,
    HarnessReplicationSubscriptionPort {
  close(): Promise<void>;
}

/**
 * Full duplex view of the same channel (user ingress + arbitrary publish +
 * subscribe + shutdown). Satisfied by `HarnessReplicationBus` implementations
 * such as `InMemoryHarnessReplicationBus`; use when adapters must emit chunks
 * and the use case must publish user turns through one handle.
 */
export interface HarnessOrchestrationChannelPort
  extends HarnessUserTurnIngressPort,
    HarnessReplicationEmitPort,
    HarnessReplicationSubscriptionPort {
  close(): Promise<void>;
}

/** Structural typing helper: a bus is already a emit + subscribe + close channel. */
export type HarnessReplicationBusAsEmitSubscribe = Pick<
  HarnessReplicationBus,
  'publish' | 'subscribe' | 'close'
>;
