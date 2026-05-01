/**
 * Core domain types for a single harness worker process.
 */

/** Opaque identifier for a worker, issued by the backend on creation. */
export type WorkerId = string & { readonly __brand: 'WorkerId' };

/** Opaque identifier for a chatroom. */
export type ChatroomId = string & { readonly __brand: 'ChatroomId' };

/** Opaque identifier for a harness session, assigned after the process spawns. */
export type HarnessSessionId = string & { readonly __brand: 'HarnessSessionId' };

/** Lifecycle state of a worker. */
export type WorkerStatus = 'pending' | 'spawning' | 'running' | 'stopped' | 'failed';

/** Represents a single harness worker and its current state. */
export interface HarnessWorker {
  readonly workerId: WorkerId;
  readonly chatroomId: ChatroomId;
  /** Identifies which harness implementation is running, e.g. 'opencode-sdk'. */
  readonly harnessName: string;
  /** Populated once the harness process has started and reported its session. */
  readonly harnessSessionId?: HarnessSessionId;
  readonly status: WorkerStatus;
  readonly createdAt: number;
}
