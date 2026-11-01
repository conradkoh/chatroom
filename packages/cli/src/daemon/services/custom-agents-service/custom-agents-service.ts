/**
 * Daemon-side custom-agent service.
 *
 * Owns one push source per watched root: the machine source (`~/.chatroom/agents`)
 * plus one workspace source per registered working directory. A source loads its
 * tree with the shared loader, stamps each agent's machine-local `disabled`
 * flag, and pushes the snapshot through `syncDefinitions` — the daemon is the
 * only writer of custom-agent rows.
 *
 * Constraints:
 * - Per-source serial chain: an older snapshot can never land after a newer one,
 *   because the next push starts only when the previous one settles.
 * - Triggers coalesce with a 500 ms trailing debounce and a 2 s maximum wait, so
 *   a burst of watch events costs one push and a continuous stream still pushes.
 * - Pushes retry with exponential backoff (1 s doubling, capped at 60 s) and stop
 *   after 5 consecutive attempts; any new trigger restarts the count.
 *   `INVALID_SCOPE` is not retried until the next membership snapshot, because
 *   only a registration or directory change can fix it.
 * - Dedup is in-memory only (`lastPushedKey`). The server no-ops too, so this is
 *   an optimisation; correctness never depends on it.
 * - A removed workspace is retired synchronously: its timers are cleared before
 *   any `await`, and in-flight work checks `retired` before pushing.
 * - Disable state is machine-local and persisted before the re-push; this
 *   service never patches a row.
 */

import { createHash } from 'node:crypto';

import { validateCustomAgentName } from '@workspace/shared/domain/custom-agent';
import type { FunctionArgs } from 'convex/server';

import type { DisabledStateStore } from './disabled-state-store.js';
import type { api } from '../../../api.js';
import type {
  LoadCustomAgentSourceInput,
  LoadedCustomAgentSource,
  loadCustomAgentSource,
} from '../../../infrastructure/services/custom-agents/index.js';
import { asConvexSessionId, type SessionId } from '../../entry/daemon-types.js';
import type { WorkspaceMembershipSource } from '../workspace-service/infrastructure/workspace-membership-source.js';

export type CustomAgentsRefreshReason = 'command' | 'watch' | 'poll' | 'membership';

export interface CustomAgentsService {
  /** Subscribes to membership and schedules the machine source. Idempotent. No-op after `stopAll`. */
  start(): void;
  /** Stops every timer and resolves once in-flight work has settled. */
  stopAll(): Promise<void>;
  /** Schedules every source. Triggers coalesce per source. */
  refresh(reason: CustomAgentsRefreshReason): void;
  /** Persists the absolute flag, then re-pushes every source. */
  setDisabled(name: string, disabled: boolean): Promise<void>;
}

type SyncDefinitionsArgs = FunctionArgs<typeof api.customAgents.syncDefinitions>;
type RejectedAgent = { name: string; reason: string };
type PushResult = { applied: boolean; rejected: RejectedAgent[] };

export interface CustomAgentsServiceDeps {
  membership: WorkspaceMembershipSource;
  machineId: string;
  /** Daemon session the push runs as. */
  sessionId: SessionId;
  /** Home root for the machine source. */
  homeDir: string;
  load: typeof loadCustomAgentSource;
  push: (args: SyncDefinitionsArgs) => Promise<PushResult>;
  state: DisabledStateStore;
  now(): number;
  setTimer(fn: () => void, ms: number): unknown;
  clearTimer(handle: unknown): void;
  log(message: string): void;
}

/** Trailing debounce and hard cap for a burst of triggers. */
const DEBOUNCE_MS = 500;
const MAX_WAIT_MS = 2_000;
const MAX_ATTEMPTS = 5;
const BASE_BACKOFF_MS = 1_000;
const MAX_BACKOFF_MS = 60_000;

type TimerSlot = 'debounceTimer' | 'maxWaitTimer' | 'retryTimer';

interface SourceSpec {
  /** Stable identity: `machine` or `workspace:<dir>`. */
  key: string;
  input: LoadCustomAgentSourceInput;
}

interface SourceRuntime {
  key: string;
  input: LoadCustomAgentSourceInput;
  /** Serial chain of pushes for this source. Never rejects. */
  chain: Promise<void>;
  debounceTimer: unknown;
  maxWaitTimer: unknown;
  retryTimer: unknown;
  /** Start of the current coalescing window, or null when idle. */
  windowStart: number | null;
  failures: number;
  lastPushedKey: string | null;
  lastRejectedKey: string | null;
  /** True after `INVALID_SCOPE`; cleared by the next membership snapshot. */
  scopeRejected: boolean;
  retired: boolean;
}

interface ServiceState {
  deps: CustomAgentsServiceDeps;
  sources: Map<string, SourceRuntime>;
  unsubscribe: (() => void) | null;
  stopped: boolean;
  /** Serial queue for disable-state writes. */
  writeChain: Promise<void>;
}

export function createCustomAgentsService(deps: CustomAgentsServiceDeps): CustomAgentsService {
  const state: ServiceState = {
    deps,
    sources: new Map(),
    unsubscribe: null,
    stopped: false,
    writeChain: Promise.resolve(),
  };
  return {
    start: () => start(state),
    stopAll: () => stopAll(state),
    refresh: (reason) => refreshAll(state, reason),
    setDisabled: (name, disabled) => setDisabled(state, name, disabled),
  };
}

// ─── Lifecycle ───────────────────────────────────────────────────────────────

function start(state: ServiceState): void {
  if (state.stopped || state.unsubscribe !== null) return;
  state.unsubscribe = state.deps.membership.subscribe((dirs) => applyMembership(state, dirs));
  ensureSource(state, machineSource(state.deps));
}

async function stopAll(state: ServiceState): Promise<void> {
  if (state.stopped) return;
  state.stopped = true;
  state.unsubscribe?.();
  state.unsubscribe = null;
  const chains = stopSources(state);
  await Promise.all(chains);
  await state.writeChain.catch(() => undefined);
}

/** Clears every timer and yields the in-flight chains so `stopAll` can await them. */
function stopSources(state: ServiceState): Promise<void>[] {
  const chains: Promise<void>[] = [];
  for (const runtime of state.sources.values()) {
    runtime.retired = true;
    clearTimers(state, runtime);
    chains.push(runtime.chain);
  }
  state.sources.clear();
  return chains;
}

// ─── Sources and membership ──────────────────────────────────────────────────

function machineSource(deps: CustomAgentsServiceDeps): SourceSpec {
  return { key: 'machine', input: { scope: 'machine', homeDir: deps.homeDir } };
}

function workspaceSource(workingDir: string): SourceSpec {
  return {
    key: `workspace:${workingDir}`,
    input: { scope: 'workspace', workspaceRoot: workingDir },
  };
}

function applyMembership(state: ServiceState, workingDirs: readonly string[]): void {
  if (state.stopped) return;
  const next = new Set(workingDirs);
  retireMissingWorkspaces(state, next);
  for (const runtime of state.sources.values()) runtime.scopeRejected = false;
  for (const dir of next) ensureSource(state, workspaceSource(dir));
}

function retireMissingWorkspaces(state: ServiceState, next: ReadonlySet<string>): void {
  for (const [key, runtime] of state.sources) {
    if (!isMissingWorkspace(runtime, next)) continue;
    state.sources.delete(key);
    runtime.retired = true;
    clearTimers(state, runtime);
  }
}

/** True for a workspace source whose directory is no longer in the membership snapshot. */
function isMissingWorkspace(runtime: SourceRuntime, next: ReadonlySet<string>): boolean {
  if (runtime.input.scope !== 'workspace') return false;
  const workingDir = runtime.input.workspaceRoot;
  return workingDir !== undefined && !next.has(workingDir);
}

function ensureSource(state: ServiceState, spec: SourceSpec): void {
  if (state.sources.has(spec.key)) return;
  const runtime = createRuntime(spec);
  state.sources.set(spec.key, runtime);
  scheduleRefresh(state, runtime);
}

function createRuntime(spec: SourceSpec): SourceRuntime {
  return {
    key: spec.key,
    input: spec.input,
    chain: Promise.resolve(),
    debounceTimer: null,
    maxWaitTimer: null,
    retryTimer: null,
    windowStart: null,
    failures: 0,
    lastPushedKey: null,
    lastRejectedKey: null,
    scopeRejected: false,
    retired: false,
  };
}

// ─── Scheduling ──────────────────────────────────────────────────────────────

function refreshAll(state: ServiceState, reason: CustomAgentsRefreshReason): void {
  if (state.stopped) return;
  state.deps.log(`[custom-agents] refresh (reason: ${reason})`);
  for (const runtime of state.sources.values()) scheduleRefresh(state, runtime);
}

/** (Re)arms the trailing debounce and, once per window, the maximum-wait timer. */
function scheduleRefresh(state: ServiceState, runtime: SourceRuntime): void {
  if (runtime.retired || state.stopped) return;
  if (runtime.windowStart === null) runtime.windowStart = state.deps.now();
  armMaxWait(state, runtime);
  clearSlot(state, runtime, 'debounceTimer');
  runtime.debounceTimer = state.deps.setTimer(() => fire(state, runtime), DEBOUNCE_MS);
}

function armMaxWait(state: ServiceState, runtime: SourceRuntime): void {
  if (runtime.maxWaitTimer !== null || runtime.windowStart === null) return;
  const elapsed = state.deps.now() - runtime.windowStart;
  runtime.maxWaitTimer = state.deps.setTimer(
    () => fire(state, runtime),
    Math.max(0, MAX_WAIT_MS - elapsed)
  );
}

/** Runs the coalesced window: cancels timers, restarts the retry count, queues a push. */
function fire(state: ServiceState, runtime: SourceRuntime): void {
  clearTimers(state, runtime);
  runtime.windowStart = null;
  runtime.failures = 0;
  enqueueRun(state, runtime);
}

function enqueueRun(state: ServiceState, runtime: SourceRuntime): void {
  runtime.chain = runtime.chain.then(() => runOnce(state, runtime));
}

// ─── Push ────────────────────────────────────────────────────────────────────

async function runOnce(state: ServiceState, runtime: SourceRuntime): Promise<void> {
  if (runtime.retired || state.stopped) return;
  try {
    await loadAndPush(state, runtime);
    runtime.failures = 0;
  } catch (error) {
    handleFailure(state, runtime, error);
  }
}

async function loadAndPush(state: ServiceState, runtime: SourceRuntime): Promise<void> {
  if (runtime.scopeRejected) return;
  const disabled = await state.deps.state.read();
  const loaded = await state.deps.load(runtime.input);
  const args = buildPushArgs(state.deps, runtime.input, loaded, disabled);
  if (!shouldPush(state, runtime, args)) return;

  const result = await state.deps.push(args);
  runtime.lastPushedKey = dedupKey(args);
  logRejectedOnce(state, runtime, result.rejected);
}

/**
 * Whether this snapshot may be pushed: an unchanged snapshot is deduped, and a
 * source retired while its load was in flight must not push, or its stale
 * snapshot could land after a newer one.
 */
function shouldPush(
  state: ServiceState,
  runtime: SourceRuntime,
  args: SyncDefinitionsArgs
): boolean {
  if (runtime.retired || state.stopped) return false;
  return dedupKey(args) !== runtime.lastPushedKey;
}

function handleFailure(state: ServiceState, runtime: SourceRuntime, error: unknown): void {
  if (runtime.retired || state.stopped) return;
  if (isInvalidScope(error)) {
    runtime.scopeRejected = true;
    state.deps.log(
      `[custom-agents] ${runtime.key} rejected with INVALID_SCOPE; waiting for the next membership snapshot`
    );
    return;
  }
  scheduleRetry(state, runtime);
}

function scheduleRetry(state: ServiceState, runtime: SourceRuntime): void {
  runtime.failures += 1;
  if (runtime.failures >= MAX_ATTEMPTS) {
    state.deps.log(
      `[custom-agents] ${runtime.key} push failed ${runtime.failures} times; waiting for the next trigger`
    );
    return;
  }
  runtime.retryTimer = state.deps.setTimer(() => {
    runtime.retryTimer = null;
    enqueueRun(state, runtime);
  }, backoffMs(runtime.failures));
}

function backoffMs(failures: number): number {
  return Math.min(BASE_BACKOFF_MS * 2 ** (failures - 1), MAX_BACKOFF_MS);
}

/** Convex errors carry the structured `data.code`; anything else is a transient failure. */
function isInvalidScope(error: unknown): boolean {
  const data = (error as { data?: unknown } | null | undefined)?.data;
  if (typeof data !== 'object' || data === null) return false;
  return (data as { code?: unknown }).code === 'INVALID_SCOPE';
}

function logRejectedOnce(
  state: ServiceState,
  runtime: SourceRuntime,
  rejected: readonly RejectedAgent[]
): void {
  const key = JSON.stringify(rejected);
  if (key === runtime.lastRejectedKey) return;
  runtime.lastRejectedKey = key;
  if (rejected.length === 0) return;
  const list = rejected.map((entry) => `${entry.name} (${entry.reason})`).join(', ');
  state.deps.log(`[custom-agents] ${runtime.key} rejected: ${list}`);
}

// ─── Disable state ───────────────────────────────────────────────────────────

async function setDisabled(state: ServiceState, name: string, disabled: boolean): Promise<void> {
  if (validateCustomAgentName(name) !== null) {
    throw new Error(`Invalid custom agent name: "${name}"`);
  }
  await enqueueWrite(state, () => persistDisabled(state, name, disabled));
  // An explicit command forces the next push even when the snapshot is unchanged;
  // the server still no-ops, so the cost is one redundant call.
  for (const runtime of state.sources.values()) runtime.lastPushedKey = null;
  refreshAll(state, 'command');
}

/** Serialises writes so two toggles can never interleave. */
function enqueueWrite(state: ServiceState, task: () => Promise<void>): Promise<void> {
  const next = state.writeChain.then(task);
  state.writeChain = next.catch(() => undefined);
  return next;
}

async function persistDisabled(
  state: ServiceState,
  name: string,
  disabled: boolean
): Promise<void> {
  const current = await state.deps.state.read();
  if (current.has(name) === disabled) return;
  const next = new Set(current);
  if (disabled) next.add(name);
  else next.delete(name);
  await state.deps.state.write(next);
}

// ─── Push payload ────────────────────────────────────────────────────────────

function buildPushArgs(
  deps: CustomAgentsServiceDeps,
  input: LoadCustomAgentSourceInput,
  loaded: LoadedCustomAgentSource,
  disabled: ReadonlySet<string>
): SyncDefinitionsArgs {
  const agents = loaded.agents.map((agent) => ({
    ...agent,
    disabled: disabled.has(agent.name),
  }));
  const base = {
    sessionId: asConvexSessionId(deps.sessionId),
    machineId: deps.machineId,
    contentHash: sourceContentHash(agents),
    agents,
    issues: loaded.issues,
  };
  if (input.workspaceRoot === undefined) {
    return { ...base, scope: 'machine' } satisfies SyncDefinitionsArgs;
  }
  return {
    ...base,
    scope: 'workspace',
    workingDir: input.workspaceRoot,
  } satisfies SyncDefinitionsArgs;
}

/** Advisory source hash over the sorted `[name, contentHash]` pairs. */
function sourceContentHash(agents: readonly { name: string; contentHash: string }[]): string {
  const pairs = agents.map((agent) => JSON.stringify([agent.name, agent.contentHash])).sort();
  return hash(pairs.join('\n'));
}

function dedupKey(args: SyncDefinitionsArgs): string {
  const agents = args.agents
    .map((agent) => [
      agent.name,
      agent.description,
      agent.systemPrompt,
      agent.inboundHandoffTemplate ?? null,
      agent.returnHandoffTemplate ?? null,
      agent.disabled,
    ])
    .sort((left, right) => String(left[0]).localeCompare(String(right[0])));
  const issues = args.issues
    .map((issue) => [issue.path, issue.reason, issue.detail ?? null])
    .sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right)));
  return hash(
    JSON.stringify({ scope: args.scope, workingDir: args.workingDir ?? null, agents, issues })
  );
}

function hash(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}

// ─── Timers ──────────────────────────────────────────────────────────────────

function clearTimers(state: ServiceState, runtime: SourceRuntime): void {
  clearSlot(state, runtime, 'debounceTimer');
  clearSlot(state, runtime, 'maxWaitTimer');
  clearSlot(state, runtime, 'retryTimer');
}

function clearSlot(state: ServiceState, runtime: SourceRuntime, slot: TimerSlot): void {
  const handle = runtime[slot];
  if (handle === null) return;
  state.deps.clearTimer(handle);
  runtime[slot] = null;
}
