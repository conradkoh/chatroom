# Workspace service

`WorkspaceService` is the sole owner of per-directory git monitoring and of the daemon → Convex
workspace state. For each active workspace it watches git, recomputes the changed units, and
hands them to the `workspace-state` outbox. No other code enqueues workspace-state units. On-demand
git reads, such as the git request handlers, are not monitoring.

## Wiring and lifecycle

- **Built** in `initDaemonEffect` (`entry/init-daemon.ts`) through `assembleDaemonSessionInit` and
  `createWorkspaceSync`. The service gets a `WorkspaceActivitySource` over the daemon's Convex
  WebSocket client, and a `WorkspaceServiceOutbox` adapter over the `workspace-state` outbox registry.
- **Started** in `entry/daemon-runtime.ts` after the task inbox starts.
- **Stopped** in `stopWorkers`, after the subscriptions and the task inbox have stopped, and before the
  outbox flush. The order is:
  1. `workspaceServiceHandle.stopAll()`: unsubscribe, stop every monitor, wait for in-flight work.
  2. `workspaceStateOutbox.flushNow()`, bounded by `shutdownFlushTimeoutMs`.
  3. `workspaceStateOutbox.stopAll()`.

  Monitors stop before the flush, so no unit can be enqueued after the final flush.

Membership follows the activity rows. A removed directory leaves the monitor map before any `await`,
so `isRegistered` is false at once, and a re-added directory never shares state with the old monitor
(`service/workspace-service.ts`). Once retired, a monitor cannot enqueue units or schedule remote polls.
After `stopKeys(workingDir)` the outbox gets no more writes for that directory (`service/workspace-service.ts`,
`createEntry`).

## Modules

| Path                                          | Role                                                                              |
| --------------------------------------------- | --------------------------------------------------------------------------------- |
| `service/workspace-service.ts`                | Membership map, tier reconciliation, `refresh`, `stopAll`.                        |
| `service/workspace-monitor.ts`                | One monitor per directory: probe loop, local recompute, remote polls, hash dedup. |
| `service/local-recompute-scheduler.ts`        | Trailing-debounced local recomputes with a max wait.                              |
| `service/remote-poll-queue.ts`                | One global serial queue for remote polls, with a per-workspace minimum gap.       |
| `service/remote-cadence.ts`                   | Pure remote poll delay and the stale-result guard (I4).                           |
| `domain/observation-tier.ts`                  | Derives `observed` / `idle` from the activity rows.                               |
| `domain/workspace-state-unit.ts`              | Unit kinds, canonical ordering, `hashUnit`.                                       |
| `domain/workspace-sync-policy.ts`             | `DEFAULT_WORKSPACE_SYNC_POLICY` and `resolveWorkspaceSyncPolicy`.                 |
| `infrastructure/workspace-git-probe.ts`       | Single `git status` poll per monitor; `diffProbeSnapshots` decides what changed.  |
| `infrastructure/local-unit-collector.ts`      | Reads local units. Does not throw on git failures.                                |
| `infrastructure/remote-unit-collector.ts`     | Reads pull requests and checks through `gh`.                                      |
| `infrastructure/workspace-activity-source.ts` | Subscribes to `listWorkspaceActivityForMachine` and validates each snapshot.      |

## Units and outbox keys

A unit is one kind of workspace state. Each (working directory, kind) pair is one outbox key,
encoded by `encodeWorkspaceStateKey`. The eight kinds are:

| Kind            | Source        | Notes                                                     |
| --------------- | ------------- | --------------------------------------------------------- |
| `head`          | local         | Always collected. It is the base of every local unit set. |
| `worktree`      | local         | Changed files.                                            |
| `upstream`      | local         | Remote tracking.                                          |
| `remotes`       | local         | Always read for `hasRemote`. Emitted only when requested. |
| `recentCommits` | local         |                                                           |
| `commands`      | local         | Collected even outside a git repo.                        |
| `pullRequests`  | remote (`gh`) |                                                           |
| `checks`        | remote (`gh`) |                                                           |

Local kinds come from `LOCAL_KINDS`. The remote kinds are `pullRequests` and `checks`.

A unit is enqueued only when its hash differs from the last hash the monitor emitted for its kind. `refresh`
clears the hashes (`service/workspace-monitor.ts`, `emit`).

## Tiers

- **Observed**: the probe loop runs, and remote polls follow `nextRemotePollDelayMs` (pending-checks,
  hot, or idle cadence). A workspace becomes observed when an activity row is recent enough.
- **Idle**: no loops. The probe stops, pending local and remote work is cancelled, and hashes are kept.
  The monitor stays alive so `refresh` and `isRegistered` keep working.
- **Idle → observed** runs a full local recompute of every local kind. It then schedules an immediate
  remote poll, and arms the probe unless the recompute found no git repo.

Tier decay is driven by `nextTransitionAt`, so an observed workspace goes idle on time even when no
new activity row arrives.

## Triggers

1. **Probe fingerprint change.** The probe runs every `probeIntervalMs` while observed. `diffProbeSnapshots`
   maps the change to local kinds. A HEAD move recomputes every local kind. An upstream move or a
   HEAD move also triggers a remote poll.
2. **`refresh`** from `daemon.gitRefresh` (`entry/command-dispatch.ts`). It clears all hashes,
   recomputes every local kind, and schedules a remote poll.
3. **GIT_PUSH local actions** (`git-pull`, `git-push`, `git-sync`, `git-discard-all`) that succeed.
   These call `refresh` too.
4. **PR actions** (`entry/workspace-git/git-subscription.ts`). After a PR action, the service is asked to
   `refresh` the directory.

Activity rows from the Convex subscription decide membership and tier. An idle → observed change
runs a full recompute (see Tiers). At most one remote poll is in flight across all workspaces. Each
workspace has its own timer, so scheduling one never delays another (`service/remote-poll-queue.ts`).

`refresh` failures are handled at the call site: `command-dispatch.ts` logs them and the command
still completes. The monitor's serial chain logs its own internal errors (I6).

## Policy

All intervals come from `DEFAULT_WORKSPACE_SYNC_POLICY` in `domain/workspace-sync-policy.ts`.
There are no environment variables, config files, or CLI options for these values. Tests build
partial overrides with `resolveWorkspaceSyncPolicy`. Production does not call it.

## Invariants

The labels below are the architect's design invariants. The source cites I4 and I6 by the same labels.

- **I1: One in-flight send per key, always the latest state.** Per (workingDir, kind) there is at most
  one in-flight send, and it always carries the latest state. (`infrastructure/outbox/lib/coalescing-state-outbox.ts`,
  `createCoalescingStateOutbox`)
- **I2: Serialized per workingDir.** Per workingDir, sends are serialized in enqueue order by the send
  adapter's chain. Initial snapshots enqueue head first. (`infrastructure/outbox/workspace-state-send.ts`,
  `runInWorkingDirChain`; head-first order in `infrastructure/local-unit-collector.ts`, `collectLocalUnits`)
- **I3: Only head writes `status`.** Units other than head never write `status`. When no row exists,
  `patchWorkspaceGitState` inserts `status: 'available'`. The daemon only emits non-head git units after a
  head `available` in the same recompute. (`infrastructure/local-unit-collector.ts`, `collectLocalUnits`;
  `services/backend/src/domain/usecase/workspace/patch-workspace-git-state.ts`, `patchWorkspaceGitState`)
- **I4: Remote results are checked before they apply.** A remote result is applied only when the branch
  and oid match the values captured at poll start (stale guard). Otherwise it is dropped and the poll runs
  again at once. (`service/remote-cadence.ts`, `isRemoteResultCurrent`)
- **I5: No write without a change.** The backend writes nothing when values are unchanged and nothing for
  inactive workspaces. (`services/backend/src/domain/usecase/workspace/patch-workspace-git-state.ts`,
  `patchWorkspaceGitState`: the `unchanged` and `workspace_inactive` results)
- **I6: One serial chain per monitor.** All monitor state transitions (local recompute, remote apply, tier
  change, refresh, stop) run on one per-monitor serial promise chain. An error is logged and never breaks
  the chain. (`service/workspace-monitor.ts`, `serial`)

Known gap against I6: `stop` does not enter the chain. It sets `stopped` synchronously, so queued tasks
skip their bodies, and then awaits the chain to drain. Closing this gap is not part of this slice.

## Failure handling

- A failed probe read is logged. After `probeFailureThreshold` failures, HEAD is re-read once and the
  probe backs off up to `probeMaxBackoffMs`.
- A failed remote read keeps the last published values. A failed `gh` read is `ok: false` for the
  whole remote result, so nothing is published from it. Remote failures back off up to
  `errorBackoffMaxMs`.
- An activity snapshot with any invalid row is ignored as a whole. Dropping one row would tear down
  its monitor and discard its pending deliveries.

## Follow-ups

- **Per-unit Convex tables.** Today units are written through `patchWorkspaceGitState`,
  `upsertRecentCommits`, and `syncCommands` (`infrastructure/outbox/workspace-state-send.ts`). The
  follow-up gives each unit kind its own table.
- **Remove the handoff-to-user enqueue.** `services/backend/convex/messages.ts` still calls
  `requestSyncOnHandoffToUser`, which enqueues `daemon.gitRefresh` for every active workspace on each
  handoff to the user. Remove it once a minimum daemon version is enforced.
