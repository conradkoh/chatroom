/**
 * Subscribes to pending direct-harness commands via Convex WS and processes
 * them sequentially.
 *
 * Each command is idempotent by `_id`: once processed it's added to a dedup
 * set so it won't be processed again (even if the daemon restarts, the
 * command status is updated to done/failed).
 *
 * Commands older than DIRECT_HARNESS_COMMAND_TTL_MS are discarded (marked
 * as failed) without processing — they represent stale requests that were
 * created before the daemon came online.
 */

import type { ConvexClient } from 'convex/browser';

import type { HarnessLifecycleManager } from './harness-lifecycle-manager.js';
import type { ActiveSession } from './session-subscriber.js';
import { api } from '../../../../api.js';
import type { NativeDirectHarnessName } from '../../../../domain/direct-harness/entities/bound-harness.js';
import type {
  HarnessSessionId,
  OpenCodeSessionId,
} from '../../../../domain/direct-harness/entities/harness-session.js';
import type { WorkspaceCapabilities } from '../../../../domain/direct-harness/entities/machine-capabilities.js';
import type { CapabilitiesPublisher } from '../../../../domain/direct-harness/ports/capabilities-publisher.js';
import type { SessionRepository } from '../../../../domain/direct-harness/ports/session-repository.js';
import type { BackendOps } from '../../../../infrastructure/deps/index.js';
import { listInstalledNativeDirectHarnesses } from '../../../../infrastructure/harnesses/registry.js';
import type { SessionId } from '../types.js';

// ─── Constants ────────────────────────────────────────────────────────────────

/** Commands pending longer than this TTL are discarded as stale. */
const DIRECT_HARNESS_COMMAND_TTL_MS = 60_000;

// ─── Session ───────────────────────────────────────────────────────────────────

/** Minimal session info extracted from DaemonContext — avoids the full ctx dependency. */
export interface DirectHarnessSession {
  readonly sessionId: SessionId;
  readonly machineId: string;
  readonly backend: BackendOps;
  readonly convexUrl: string;
}

// ─── Convex shape types ──────────────────────────────────────────────────────

/** Shape of a command row from listPendingCommands. */
interface PendingCommand {
  _id: string;
  _creationTime: number;
  machineId: string;
  workspaceId: string;
  type: 'refreshCapabilities' | 'refreshSessionTitle' | 'closeSession';
  refreshCapabilities?: { initiatedBy: string };
  refreshSessionTitle?: { harnessSessionId: string };
  closeSession?: { harnessSessionId: string };
  status: string;
  createdAt: number;
  completedAt?: number;
  errorMessage?: string;
}

/** The command payload for refreshCapabilities. */
interface RefreshCapabilitiesPayload {
  initiatedBy: string;
}

// ─── Deps ────────────────────────────────────────────────────────────────────

export interface CommandSubscriberDeps {
  /** Manages harness lifecycle: auto-start and inactivity-based shutdown. */
  readonly lifecycleManager: HarnessLifecycleManager;
  /** Publishes capability snapshots to the machine registry. */
  readonly publisher: CapabilitiesPublisher;
  /** Live harness session handles keyed by harnessSessionRowId. */
  readonly activeSessions: Map<string, ActiveSession>;
  /** Backend session status mutations. */
  readonly sessionRepository: SessionRepository;
}

// ─── Subscriber ──────────────────────────────────────────────────────────────

export function startCommandSubscriber(
  session: DirectHarnessSession,
  wsClient: ConvexClient,
  deps: CommandSubscriberDeps
): { stop: () => void } {
  /** Dedup set of command _id values already processed or in-flight. */
  const processed = new Set<string>();
  let processing = false;
  let pendingDrain = false;

  const runDrain = () => {
    if (processing) {
      pendingDrain = true;
      return;
    }
    processing = true;
    pendingDrain = false;
    void drain(session, deps, processed).finally(() => {
      processing = false;
      if (pendingDrain) runDrain();
    });
  };

  const unsub = wsClient.onUpdate(
    api.daemon.directHarness.commands.listPendingCommands,
    { sessionId: session.sessionId, machineId: session.machineId },
    () => runDrain(),
    (err: unknown) => {
      console.warn(
        '[direct-harness] Command subscription error:',
        err instanceof Error ? err.message : String(err)
      );
    }
  );

  return { stop: unsub };
}

// ─── Drain loop ──────────────────────────────────────────────────────────────

/**
 * Fetch all pending commands and process each one sequentially.
 * Commands are processed one at a time to avoid race conditions on shared
 * state (e.g., two capabilities refreshes in flight).
 */
async function dispatchPendingCommand(
  session: DirectHarnessSession,
  deps: CommandSubscriberDeps,
  cmd: PendingCommand
): Promise<void> {
  switch (cmd.type) {
    case 'refreshCapabilities':
      await handleRefreshCapabilities(session, deps, cmd);
      break;
    case 'refreshSessionTitle':
      await handleRefreshSessionTitle(session, deps, cmd);
      break;
    case 'closeSession':
      await handleCloseSession(session, deps, cmd);
      break;
    default:
      await markFailed(session, cmd._id, `Unknown command type: ${cmd.type}`);
  }
}

async function processPendingCommand(
  session: DirectHarnessSession,
  deps: CommandSubscriberDeps,
  cmd: PendingCommand,
  now: number
): Promise<void> {
  if (now - cmd.createdAt > DIRECT_HARNESS_COMMAND_TTL_MS) {
    console.log(
      `[direct-harness] Discarding stale command ${cmd._id} (type=${cmd.type}, age=${now - cmd.createdAt}ms)`
    );
    await markFailed(session, cmd._id, 'Command expired (TTL)');
    return;
  }

  await dispatchPendingCommand(session, deps, cmd);
}

// fallow-ignore-next-line complexity
async function drain(
  session: DirectHarnessSession,
  deps: CommandSubscriberDeps,
  processed: Set<string>
): Promise<void> {
  const pending = (await session.backend.query(
    api.daemon.directHarness.commands.listPendingCommands,
    { sessionId: session.sessionId, machineId: session.machineId }
  )) as PendingCommand[] | null;

  if (!pending || pending.length === 0) return;

  const now = Date.now();

  for (const cmd of pending) {
    if (processed.has(cmd._id)) continue;
    processed.add(cmd._id);

    try {
      await processPendingCommand(session, deps, cmd, now);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.warn(`[direct-harness] Command ${cmd._id} failed: ${message}`);
      await markFailed(session, cmd._id, message).catch(() => {});
    }
  }
}

// ─── Command handlers ─────────────────────────────────────────────────────────

async function handleRefreshCapabilities(
  session: DirectHarnessSession,
  deps: CommandSubscriberDeps,
  cmd: PendingCommand
): Promise<void> {
  const payload = cmd.refreshCapabilities as RefreshCapabilitiesPayload | undefined;
  console.log(
    `[direct-harness] Processing refreshCapabilities for workspace=${cmd.workspaceId}` +
      (payload ? ` (initiatedBy=${payload.initiatedBy})` : '')
  );

  const installed = await listInstalledNativeDirectHarnesses();
  const harnessEntries: WorkspaceCapabilities['harnesses'][number][] = [];
  let cwd = '';

  for (const harnessName of installed) {
    const harness = await deps.lifecycleManager.getOrStart(cmd.workspaceId, harnessName);
    cwd = harness.cwd;
    const [agents, providers] = await Promise.all([harness.listAgents(), harness.listProviders()]);
    harnessEntries.push({
      name: harness.type,
      displayName: harness.displayName,
      agents: [...agents],
      providers: [...providers],
    });
  }

  const existing = (await session.backend.query(
    api.daemon.directHarness.capabilities.getForMachine,
    { sessionId: session.sessionId, machineId: session.machineId }
  )) as { workspaces?: WorkspaceCapabilities[] } | null;

  const updatedWorkspace: WorkspaceCapabilities = {
    workspaceId: cmd.workspaceId,
    cwd,
    name: cwd,
    harnesses: harnessEntries,
  };

  const merged = [
    ...(existing?.workspaces ?? []).filter((ws) => ws.workspaceId !== cmd.workspaceId),
    updatedWorkspace,
  ];

  await deps.publisher.publish({
    machineId: session.machineId,
    lastSeenAt: Date.now(),
    workspaces: merged,
  });

  await session.backend.mutation(api.daemon.directHarness.commands.updateCommandStatus, {
    sessionId: session.sessionId,
    commandId: cmd._id,
    status: 'done',
  });

  console.log(`[direct-harness] Capabilities refreshed for workspace=${cmd.workspaceId}`);
}

// fallow-ignore-next-line complexity
async function handleRefreshSessionTitle(
  session: DirectHarnessSession,
  deps: CommandSubscriberDeps,
  cmd: PendingCommand
): Promise<void> {
  const { harnessSessionId } = (cmd.refreshSessionTitle ?? {}) as { harnessSessionId?: string };
  if (!harnessSessionId) {
    await markFailed(session, cmd._id, 'refreshSessionTitle: missing harnessSessionId');
    return;
  }

  // Look up the opencodeSessionId from the backend
  const sessionRow = (await session.backend.query(api.daemon.directHarness.sessions.getSession, {
    harnessSessionId,
  })) as { opencodeSessionId?: string; harnessName?: string; workspaceId?: string } | null;

  if (!sessionRow?.opencodeSessionId) {
    // Session not yet associated — nothing to fetch
    await session.backend.mutation(api.daemon.directHarness.commands.updateCommandStatus, {
      sessionId: session.sessionId,
      commandId: cmd._id,
      status: 'done',
    });
    return;
  }

  // Use the running harness to fetch the title from OpenCode
  const harnessName = (sessionRow.harnessName ?? 'opencode-sdk') as NativeDirectHarnessName;
  const harness = await deps.lifecycleManager.getOrStart(
    sessionRow.workspaceId ?? cmd.workspaceId,
    harnessName
  );
  const newTitle = await harness.fetchSessionTitle(sessionRow.opencodeSessionId);

  if (newTitle) {
    await session.backend.mutation(api.daemon.directHarness.sessions.updateSessionTitle, {
      sessionId: session.sessionId,
      harnessSessionId,
      sessionTitle: newTitle,
    });
    console.log(`[direct-harness] Refreshed title for session ${harnessSessionId}: "${newTitle}"`);
  }

  await session.backend.mutation(api.daemon.directHarness.commands.updateCommandStatus, {
    sessionId: session.sessionId,
    commandId: cmd._id,
    status: 'done',
  });
}

interface HarnessSessionRow {
  status?: string;
  opencodeSessionId?: string;
  harnessName?: string;
  workspaceId?: string;
}

async function closeDisconnectedHarnessSession(
  deps: CommandSubscriberDeps,
  sessionRow: HarnessSessionRow,
  harnessSessionId: string
): Promise<void> {
  if (!sessionRow.opencodeSessionId) {
    await deps.sessionRepository.markClosed(harnessSessionId);
    return;
  }

  const harnessName = (sessionRow.harnessName ?? 'opencode-sdk') as NativeDirectHarnessName;
  const harness = await deps.lifecycleManager.getOrStart(sessionRow.workspaceId ?? '', harnessName);
  const liveSession = await harness.resumeSession(
    sessionRow.opencodeSessionId as OpenCodeSessionId,
    {
      harnessSessionId: harnessSessionId as HarnessSessionId,
    }
  );
  await liveSession.close();
  await deps.sessionRepository.markClosed(harnessSessionId);
}

/** Gracefully close a harness session — exported for unit tests. */
// fallow-ignore-next-line complexity unused-export
export async function closeHarnessSession(
  session: DirectHarnessSession,
  deps: CommandSubscriberDeps,
  harnessSessionId: string
): Promise<void> {
  const sessionRow = (await session.backend.query(api.daemon.directHarness.sessions.getSession, {
    harnessSessionId,
  })) as HarnessSessionRow | null;

  if (!sessionRow) {
    throw new Error(`Harness session ${harnessSessionId} not found`);
  }

  if (sessionRow.status === 'closed' || sessionRow.status === 'failed') {
    return;
  }

  const handle = deps.activeSessions.get(harnessSessionId);
  if (handle) {
    await handle.close();
    deps.activeSessions.delete(harnessSessionId);
    return;
  }

  await closeDisconnectedHarnessSession(deps, sessionRow, harnessSessionId);
}

async function handleCloseSession(
  session: DirectHarnessSession,
  deps: CommandSubscriberDeps,
  cmd: PendingCommand
): Promise<void> {
  const { harnessSessionId } = (cmd.closeSession ?? {}) as { harnessSessionId?: string };
  if (!harnessSessionId) {
    await markFailed(session, cmd._id, 'closeSession: missing harnessSessionId');
    return;
  }

  console.log(`[direct-harness] Processing closeSession for harnessSessionId=${harnessSessionId}`);

  await closeHarnessSession(session, deps, harnessSessionId);

  await session.backend.mutation(api.daemon.directHarness.commands.updateCommandStatus, {
    sessionId: session.sessionId,
    commandId: cmd._id,
    status: 'done',
  });

  console.log(`[direct-harness] Closed session ${harnessSessionId}`);
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Mark a command as failed with an error message. */
async function markFailed(
  session: DirectHarnessSession,
  commandId: string,
  errorMessage: string
): Promise<void> {
  await session.backend.mutation(api.daemon.directHarness.commands.updateCommandStatus, {
    sessionId: session.sessionId,
    commandId,
    status: 'failed',
    errorMessage,
  });
}
