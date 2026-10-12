# Workspace service

`WorkspaceService` is the sole owner of per-directory git monitoring and of the daemon → Convex
workspace state. For each active workspace it watches git, recomputes the changed units, and
hands them to the `workspace-state` outbox. No other code enqueues workspace-state units. On-demand
git reads, such as the git request handlers, are not monitoring.

Paths are relative to this directory, except paths that start with `packages/` or `services/`, which
are repo-root paths.

## Wiring and lifecycle

- **Built** in `initDaemonEffect` (`packages/cli/src/daemon/entry/init-daemon.ts`) through
  `assembleDaemonSessionInit` and `createWorkspaceSync`. The service gets a `WorkspaceActivitySource`
  over the daemon's Convex WebSocket client, and a `WorkspaceServiceOutbox` adapter over the
  `workspace-state` outbox registry.
- **Started** in `packages/cli/src/daemon/entry/daemon-runtime.ts` after the task inbox starts.
- **Stopped** in `stopWorkers` (`packages/cli/src/daemon/entry/daemon-runtime.ts`). The subscriptions
  and the task inbox stop first. Then:
  1. `workspaceServiceHandle.stopAll()`: unsubscribes, stops every monitor, stops the file tree, and
     stops the remote queue. Each step waits for in-flight work. A file-tree stop failure is logged,
     and the remote queue still stops.
  2. `workspaceStateOutbox.flushNow()`, bounded by `shutdownFlushTimeoutMs`
     (`DEFAULT_WORKSPACE_SYNC_POLICY.outbox`). A flush that has not settled when the bound expires is
     abandoned, and shutdown continues.
  3. `workspaceStateOutbox.stopAll()`.

  Monitors stop before the flush, so no unit is enqueued after the final flush. Unsubscribing runs
  first, so no new membership input arrives while the monitors stop.

Membership follows the activity rows. A removed directory leaves the monitor map before any `await`,
so `isRegistered` is false at once, and a re-added directory never shares state with the old monitor
(`service/workspace-service.ts`). Once retired, a monitor cannot enqueue units or schedule remote polls.
After `stopKeys(workingDir)` the outbox gets no more writes for that directory (`service/workspace-service.ts`,
`createEntry`).

## Modules

| Path                                          | Role                                                                                                                                                   |
| --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `index.ts`                                    | Public exports: `createWorkspaceService`, the activity source, and `DEFAULT_WORKSPACE_SYNC_POLICY`.                                                    |
| `service/workspace-service.ts`                | Membership map, tier reconciliation, `refresh`, `stopAll`, and the root snapshot reader (`probeRootSnapshotReader`).                                   |
| `service/workspace-monitor.ts`                | One monitor per directory: probe loop, local recompute, remote polls, hash dedup.                                                                      |
| `service/workspace-file-tree-host.ts`         | Per-directory file-tree coordinators (`ensure`, `stop`, `disable`, `oneShot`, `stopAll`) and their outbox registries.                                  |
| `service/local-recompute-scheduler.ts`        | Trailing-debounced local recomputes with a max wait.                                                                                                   |
| `service/remote-poll-queue.ts`                | One global serial queue for remote polls, with a per-workspace minimum gap.                                                                            |
| `service/remote-cadence.ts`                   | Pure remote poll delay and the stale-result guard (I4).                                                                                                |
| `domain/observation-tier.ts`                  | Derives `observed` / `idle` from the activity rows.                                                                                                    |
| `domain/workspace-state-unit.ts`              | Unit kinds, canonical ordering, `hashUnit`.                                                                                                            |
| `domain/workspace-sync-policy.ts`             | `DEFAULT_WORKSPACE_SYNC_POLICY` and `resolveWorkspaceSyncPolicy`.                                                                                      |
| `infrastructure/workspace-git-probe.ts`       | Single `git status` poll per monitor; `diffProbeSnapshots` decides what changed; `toRootChangeSourceSnapshot` projects a snapshot for the root reader. |
| `infrastructure/local-unit-collector.ts`      | Reads local units. Does not throw on git failures.                                                                                                     |
| `infrastructure/remote-unit-collector.ts`     | Reads pull requests and checks through `gh`.                                                                                                           |
| `infrastructure/workspace-activity-source.ts` | Subscribes to `listWorkspaceActivityForMachine` and validates each snapshot.                                                                           |

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
- **Idle**: the probe loop stops, and pending local recomputes and queued remote polls are cancelled.
  Hashes are kept, so a unit that is unchanged when the workspace returns is not sent again. The
  monitor stays registered, so `isRegistered` is true. `refresh` still works: it recomputes every
  local unit and runs one remote poll. A remote poll already in flight finishes, and it does not
  reschedule while idle, except for the immediate retry after a stale result (I4). The root file-tree
  read is not a monitor loop, so idle does not stop it (see Root file-tree read).
- **Idle → observed** runs a full local recompute of every local kind. It then schedules an immediate
  remote poll, and arms the probe unless the recompute found no git repo.

Tier decay is driven by `nextTransitionAt`, so an observed workspace goes idle on time even when no
new activity row arrives.

## Triggers

1. **Probe fingerprint change.** The probe runs every `probeIntervalMs` while observed. `diffProbeSnapshots`
   maps the change to local kinds. A HEAD move recomputes every local kind. An upstream move or a
   HEAD move also triggers a remote poll.
2. **`refresh`** from `daemon.gitRefresh` (`packages/cli/src/daemon/entry/command-dispatch.ts`). It clears all hashes,
   recomputes every local kind, and schedules a remote poll.
3. **GIT_PUSH local actions** (`git-pull`, `git-push`, `git-sync`, `git-discard-all`) that succeed.
   These call `refresh` with reason `local-action`.
4. **PR actions** (`packages/cli/src/daemon/entry/workspace-git/git-subscription.ts`). After a PR action, the service is asked to
   `refresh` the directory.

Activity rows from the Convex subscription decide membership and tier. An idle → observed change
runs a full recompute (see Tiers). At most one remote poll is in flight across all workspaces. Each
workspace has its own timer, so scheduling one never delays another (`service/remote-poll-queue.ts`).

`refresh` failures are handled at the call site: `command-dispatch.ts` logs them and the command
still completes. The monitor's serial chain logs its own internal errors (I6).

## Root file-tree read

The file-tree coordinator for a workspace root gets its root HEAD and status from the reader that
`probeRootSnapshotReader` builds (`service/workspace-service.ts`). The coordinator's change source
(`packages/cli/src/infrastructure/services/workspace/git-workspace-change-source.ts`) calls that reader
once per tick for the root node.

- **Shared probe.** The reader reads the monitor's probe. A snapshot up to `probeIntervalMs` old is
  reused, and an older one is re-read. The monitor tick and the root poll therefore share one `git status`.
- **Rename limit.** `readGitRenameLimit` runs `git config`. Its result is cached for 10 probe intervals
  (30s at the default policy). A `status.renameLimit` or `diff.renameLimit` change reaches the root
  projection within that window.
- **Declined ticks.** The reader resolves `undefined` for a tick whose projection cannot be proven equal
  to v1: a pathspec with glob or magic syntax, a rename or copy in the snapshot, or a rename limit that
  may skip rename detection. The change source then reads git directly for that tick, which is v1.
- **No monitor.** A directory with no monitor resolves `undefined`, so its coordinator reads v1 for its
  whole lifetime. The reader is resolved once per coordinator start.
- **Parity.** Each projection equals v1 as of the snapshot's read time. It can therefore lag the working
  tree by up to one probe interval. A probe or config failure rejects the tick, and the change source
  reports it through `onError`.

The constraints are documented on `probeRootSnapshotReader` and `toRootChangeSourceSnapshot`
(`infrastructure/workspace-git-probe.ts`).

## Known limits

- **Root file-tree lag.** The root file-tree projection can trail the working tree by up to one
  `probeIntervalMs` (3s at the default policy). The cache is not shortened to close this gap.
- **Rename-limit window.** A `status.renameLimit` or `diff.renameLimit` change reaches the root
  projection within 10 probe intervals (30s at the default policy).

Both are explained under [Root file-tree read](#root-file-tree-read).

## Policy

All intervals come from `DEFAULT_WORKSPACE_SYNC_POLICY` in `domain/workspace-sync-policy.ts`.
There are no environment variables, config files, or CLI options for these values. Tests build
partial overrides with `resolveWorkspaceSyncPolicy`. Production does not call it.

`probeIntervalMs` also bounds how old a snapshot the root file-tree read may reuse, and it sets the
rename-limit cache at ten times that value.

## Invariants

The labels below are the architect's design invariants. The source cites I4 and I6 by the same labels.

- **I1: One in-flight send per key, always the latest state.** Per (workingDir, kind) there is at most
  one in-flight send, and it always carries the latest state. (`packages/cli/src/daemon/infrastructure/outbox/lib/coalescing-state-outbox.ts`,
  `createCoalescingStateOutbox`)
- **I2: Serialized per workingDir.** Per workingDir, sends are serialized in enqueue order by the send
  adapter's chain. Initial snapshots enqueue head first. (`packages/cli/src/daemon/infrastructure/outbox/workspace-state-send.ts`,
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
skip their bodies, and then awaits the chain to drain. This gap is not yet closed.

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
  `upsertRecentCommits`, and `syncCommands` (`packages/cli/src/daemon/infrastructure/outbox/workspace-state-send.ts`). The
  follow-up gives each unit kind its own table.
- **Remove the handoff-to-user enqueue.** `services/backend/convex/messages.ts` still calls
  `requestSyncOnHandoffToUser`, which enqueues `daemon.gitRefresh` for every active workspace on each
  handoff to the user. Remove it once a minimum daemon version is enforced.
