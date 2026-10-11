import { openDurableCoalescingStateStore } from './lib/durable-coalescing-state-store.js';
import {
  createKeyedCoalescingStateOutboxRegistry,
  type KeyedCoalescingStateOutboxRegistry,
} from './lib/keyed-coalescing-state-outbox-registry.js';
import { isOutboxArgumentValidationError, type OutboxErrorLogger } from './lib/outbox-failure.js';
import { resolveOutboxDbPath } from './outbox-db-path.js';
import {
  workspaceStateUnitSchema,
  type WorkspaceStateUnit,
} from './workspace-state-outbox-schema.js';

export type WorkspaceStateKind = WorkspaceStateUnit['kind'];
export type WorkspaceStateSendResult = { applied: boolean };
export type WorkspaceStateOutboxRegistry = KeyedCoalescingStateOutboxRegistry<
  WorkspaceStateUnit,
  WorkspaceStateSendResult
>;

/**
 * Delivery key for one (workingDir, kind) pair. The JSON tuple keeps the key
 * unambiguous for any path characters, and the kind is recoverable for per-kind throttling.
 * Constraint: keys are only produced here, so `decodeWorkspaceStateKey` assumes this format.
 */
// Reason: the daemon builds these keys once S5 wires the outbox; unit tests use it until then.
// fallow-ignore-next-line unused-export
export function encodeWorkspaceStateKey(workingDir: string, kind: WorkspaceStateKind): string {
  return JSON.stringify([workingDir, kind]);
}

const WORKSPACE_STATE_KINDS: ReadonlySet<string> = new Set<WorkspaceStateKind>([
  'head',
  'worktree',
  'upstream',
  'remotes',
  'pullRequests',
  'checks',
  'recentCommits',
  'commands',
]);

/**
 * Throws on any key that `encodeWorkspaceStateKey` could not have produced, so a corrupt
 * durable row fails loudly instead of being routed with an unknown kind.
 */
export function decodeWorkspaceStateKey(key: string): {
  workingDir: string;
  kind: WorkspaceStateKind;
} {
  const parsed = parseKeyTuple(key);
  const [workingDir, kind] = parsed ?? [];
  if (typeof workingDir !== 'string' || !isWorkspaceStateKind(kind)) {
    throw new Error(`Malformed workspace-state key: ${key}`);
  }
  return { workingDir, kind };
}

/** Returns the raw `[workingDir, kind]` pair, or null when the key is not a 2-element JSON array. */
function parseKeyTuple(key: string): unknown[] | null {
  try {
    const parsed: unknown = JSON.parse(key);
    return Array.isArray(parsed) && parsed.length === 2 ? parsed : null;
  } catch {
    return null;
  }
}

function isWorkspaceStateKind(value: unknown): value is WorkspaceStateKind {
  return typeof value === 'string' && WORKSPACE_STATE_KINDS.has(value);
}

/**
 * Argument-schema rejection and a commands-limit rejection will never succeed on retry,
 * so they are quarantined instead of retried forever.
 */
function isWorkspaceStatePermanentError(error: unknown): boolean {
  return (
    isOutboxArgumentValidationError(error) ||
    (error instanceof Error && /Too many commands/.test(error.message))
  );
}

// Reason: the daemon constructs this registry once S5 wires the outbox; unit tests use it until then.
// fallow-ignore-next-line unused-export
export function createWorkspaceStateOutboxRegistry(
  machineId: string,
  createSend: (key: string) => (unit: WorkspaceStateUnit) => Promise<WorkspaceStateSendResult>,
  options: {
    /** Throttle per unit kind; each (workingDir, kind) pair is throttled independently. */
    minIntervalMsByKind: Record<WorkspaceStateKind, number>;
    retryDelayMs: number;
    maxRetryDelayMs: number;
    onError?: ((key: string, error: unknown) => void) | undefined;
    logger?: OutboxErrorLogger | undefined;
  }
): WorkspaceStateOutboxRegistry {
  return createKeyedCoalescingStateOutboxRegistry<WorkspaceStateUnit, WorkspaceStateSendResult>({
    store: openDurableCoalescingStateStore(resolveOutboxDbPath(machineId, 'workspace-state')),
    serialize: JSON.stringify,
    deserialize: (json) => workspaceStateUnitSchema.parse(JSON.parse(json)),
    createSend,
    resolveMinIntervalMs: (key) => options.minIntervalMsByKind[decodeWorkspaceStateKey(key).kind],
    retryDelayMs: options.retryDelayMs,
    maxRetryDelayMs: options.maxRetryDelayMs,
    onError: options.onError,
    logger: options.logger,
    isPermanentError: isWorkspaceStatePermanentError,
  });
}
