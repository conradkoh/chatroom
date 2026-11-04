/**
 * Production wiring for the daemon's custom-agent service.
 *
 * Binds the service's injected dependencies to the real implementation: the
 * shared loader, a file-backed disable store under `~/.chatroom/daemon/<id>/`,
 * and an authenticated `syncDefinitions` call through the daemon's Convex
 * client. It also owns the fallback poll and a second subscription to the
 * workspace membership source, which is what un-parks a source the backend
 * rejected with `INVALID_SCOPE`.
 *
 * Failure isolation: `start()` errors are caught by the caller, and the poll or
 * membership callback never throws into the daemon's event loop.
 */

import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

import { watch } from 'chokidar';
import type { FunctionArgs } from 'convex/server';

import { createCustomAgentWatchers, type CustomAgentWatchers } from './custom-agent-watchers.js';
import type { CustomAgentsService } from './custom-agents-service.js';
import { createCustomAgentsService } from './custom-agents-service.js';
import { createFileDisabledStateStore } from './disabled-state-store.js';
import { api } from '../../../api.js';
import { loadCustomAgentSource } from '../../../infrastructure/services/custom-agents/index.js';
import { resolveCustomAgentDisabledStatePath } from '../../entry/custom-agent-state-path.js';
import type { ConvexClient, SessionId } from '../../entry/daemon-types.js';
import type { WorkspaceMembershipSource } from '../workspace-service/infrastructure/workspace-membership-source.js';

/** Fallback cadence. Watchers handle the common case; dedup makes an unchanged poll nearly free. */
const POLL_INTERVAL_MS = 60_000;

export interface BuildCustomAgentsServiceInput {
  membership: WorkspaceMembershipSource;
  machineId: string;
  sessionId: SessionId;
  convex: ConvexClient;
  log(message: string): void;
  /** Home root for the machine source. Defaults to `os.homedir()`; tests override it. */
  homeDir?: string | undefined;
  /** Disable-state file. Defaults to the per-machine daemon path; tests override it. */
  statePath?: string | undefined;
  /** File watcher factory. Defaults to chokidar's `watch`; tests inject a counting wrapper. */
  watch?: typeof watch | undefined;
}

export function buildCustomAgentsService(input: BuildCustomAgentsServiceInput): {
  service: CustomAgentsService;
  stopPoll(): void;
} {
  const inner = createConfiguredService(input);
  /** Last membership snapshot, replayed when the watchers start after it arrives. */
  let workingDirs: readonly string[] = [];
  let watching = false;

  const syncWatchers = (): void => {
    if (!watching) return;
    watchers.syncRoots(rootDirectories(input, workingDirs));
  };
  const watchers = createRootsWatchers(input, () => service.refresh('watch'));

  const service: CustomAgentsService = {
    start: () => {
      inner.start();
      watching = true;
      syncWatchers();
    },
    stopAll: () => inner.stopAll(),
    refresh: (reason) => inner.refresh(reason),
    setDisabled: (name, disabled) => inner.setDisabled(name, disabled),
  };

  // The poll is also the backstop for a root that did not exist when the last
  // membership snapshot arrived: `syncWatchers` skips missing roots, so re-running
  // it here attaches the watcher as soon as `.chatroom/agents` is created.
  const poll = setInterval(() => {
    syncWatchers();
    service.refresh('poll');
  }, POLL_INTERVAL_MS);
  poll.unref?.();
  const unsubscribe = input.membership.subscribe((dirs) => {
    workingDirs = dirs;
    syncWatchers();
    // A membership snapshot also un-parks a source rejected with INVALID_SCOPE.
    service.refresh('membership');
  });

  return {
    service,
    stopPoll: () => {
      clearInterval(poll);
      unsubscribe();
      void watchers.closeAll().catch(() => undefined);
    },
  };
}

/** Binds the service to the real loader, store, timers, and Convex push. */
function createConfiguredService(input: BuildCustomAgentsServiceInput): CustomAgentsService {
  return createCustomAgentsService({
    membership: input.membership,
    machineId: input.machineId,
    sessionId: input.sessionId,
    homeDir: machineHomeDir(input),
    load: loadCustomAgentSource,
    push: (args) => pushSnapshot(input.convex, args),
    state: createFileDisabledStateStore(
      input.statePath ?? resolveCustomAgentDisabledStatePath(input.machineId)
    ),
    now: Date.now,
    setTimer: (fn, ms) => setTimeout(fn, ms),
    clearTimer: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
    log: input.log,
  });
}

/** The watcher set, bound to the machine root and (later) each workspace root. */
function createRootsWatchers(
  input: BuildCustomAgentsServiceInput,
  onChange: () => void
): CustomAgentWatchers {
  return createCustomAgentWatchers({
    onChange,
    log: input.log,
    watch: input.watch ?? watch,
    existsSync,
  });
}

function machineHomeDir(input: BuildCustomAgentsServiceInput): string {
  return input.homeDir ?? homedir();
}

/** Every root the loader scans: the machine root plus one per registered workspace. */
function rootDirectories(
  input: BuildCustomAgentsServiceInput,
  workingDirs: readonly string[]
): string[] {
  return [machineAgentsRoot(input), ...workingDirs.map(workspaceAgentsRoot)];
}

function machineAgentsRoot(input: BuildCustomAgentsServiceInput): string {
  return join(machineHomeDir(input), '.chatroom', 'agents');
}

/** The directory the loader scans for one workspace. */
function workspaceAgentsRoot(workingDir: string): string {
  return join(workingDir, '.chatroom', 'agents');
}

type SyncDefinitionsArgs = FunctionArgs<typeof api.customAgents.syncDefinitions>;
type PushResult = { applied: boolean; rejected: { name: string; reason: string }[] };

/** The daemon's only Convex write on this path; the server re-validates everything. */
async function pushSnapshot(convex: ConvexClient, args: SyncDefinitionsArgs): Promise<PushResult> {
  const result = await convex.mutation(api.customAgents.syncDefinitions, args);
  return { applied: result.applied, rejected: result.rejected };
}
