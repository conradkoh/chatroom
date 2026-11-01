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

import { homedir } from 'node:os';

import type { FunctionArgs } from 'convex/server';

import type { CustomAgentsService } from './custom-agents-service.js';
import { createCustomAgentsService } from './custom-agents-service.js';
import { createFileDisabledStateStore } from './disabled-state-store.js';
import { api } from '../../../api.js';
import { loadCustomAgentSource } from '../../../infrastructure/services/custom-agents/index.js';
import { resolveCustomAgentDisabledStatePath } from '../../entry/custom-agent-state-path.js';
import type { ConvexClient, SessionId } from '../../entry/daemon-types.js';
import type { WorkspaceMembershipSource } from '../workspace-service/infrastructure/workspace-membership-source.js';

/** Fallback cadence until watchers land in S3c2. Dedup makes an unchanged poll nearly free. */
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
}

export function buildCustomAgentsService(input: BuildCustomAgentsServiceInput): {
  service: CustomAgentsService;
  /** Clears the poll and unsubscribes the membership follow-up. Idempotent. */
  stopPoll(): void;
} {
  const service = createCustomAgentsService({
    membership: input.membership,
    machineId: input.machineId,
    sessionId: input.sessionId,
    homeDir: input.homeDir ?? homedir(),
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

  const poll = setInterval(() => service.refresh('poll'), POLL_INTERVAL_MS);
  poll.unref?.();
  const unsubscribe = input.membership.subscribe(() => service.refresh('membership'));

  return {
    service,
    stopPoll: () => {
      clearInterval(poll);
      unsubscribe();
    },
  };
}

type SyncDefinitionsArgs = FunctionArgs<typeof api.customAgents.syncDefinitions>;
type PushResult = { applied: boolean; rejected: { name: string; reason: string }[] };

/** The daemon's only Convex write on this path; the server re-validates everything. */
async function pushSnapshot(convex: ConvexClient, args: SyncDefinitionsArgs): Promise<PushResult> {
  const result = await convex.mutation(api.customAgents.syncDefinitions, args);
  return { applied: result.applied, rejected: result.rejected };
}
