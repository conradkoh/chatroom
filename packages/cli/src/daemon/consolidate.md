# Daemon module consolidation index

> Planning doc only — no moves executed yet. Branch: `feat/daemon-module-rename` (PR #1311).

## Verdict legend

| Verdict              | Meaning                                                                  |
| -------------------- | ------------------------------------------------------------------------ |
| **consolidate**      | Move to target path under `daemon/`; update imports; delete source       |
| **consolidate+shim** | Move to `daemon/`; leave thin re-export at old path for external callers |
| **delete-shim**      | Already duplicated in `daemon/`; delete shim after import update         |
| **defer**            | Consolidate later — blocker or needs design decision                     |
| **keep**             | Stays outside `daemon/` — shared with non-daemon code or wrong layer     |

## Recommended phase order

1. Phase 0: Delete U14 shims (8 files) + enhancer re-export shims (2 files)
2. Phase 1: `events/daemon/` → `daemon/entry/events/`
3. Phase 2: `infrastructure/daemon/`, `domain/native-integration/`, `domain/harness-activity-emitter.ts`
4. Phase 3: `infrastructure/git/` → `daemon/infrastructure/git/`
5. Phase 4: `agent-process-manager/` → `daemon/infrastructure/agent-process-manager/`
6. Phase 5: `daemon-start/handlers/` → `daemon/entry/handlers/`
7. Phase 6: `daemon-start/{direct-harness,agentic-query,file-*,shared-harness}/` → matching `daemon/entry/` subtrees
8. Phase 7: `daemon-start/` root files (`daemon-services`, `types`, `deps`, …)
9. Phase 8: `remote-agents/` + `infrastructure/harnesses/` — partial; see defer notes and open decisions

## Summary counts

| Verdict          | File count |
| ---------------- | ---------- |
| consolidate      | 119        |
| consolidate+shim | 26         |
| delete-shim      | 18         |
| defer            | 3          |
| keep             | 5          |

> Counts cover every non-test `.ts` file listed in sections 1–10 (70 `daemon-start/` sources + 8 `events/daemon/` + 8 `infrastructure/git/` + 61 `remote-agents/` + other candidates). Co-located `*.test.ts` files (19 under `daemon-start/`) move with their sources.

---

## 1. `commands/machine/daemon-start/` shims (Phase 0)

| Current                               | Target | Verdict     | Rationale                                                                     |
| ------------------------------------- | ------ | ----------- | ----------------------------------------------------------------------------- |
| `init.ts`                             | —      | delete-shim | Re-exports `daemon/entry/init-daemon.ts`                                      |
| `git-heartbeat.ts`                    | —      | delete-shim | Re-exports `daemon/entry/workspace-git/git-heartbeat.ts`                      |
| `git-subscription.ts`                 | —      | delete-shim | Re-exports `daemon/entry/workspace-git/git-subscription.ts`                   |
| `task-monitor.ts`                     | —      | delete-shim | Re-exports `daemon/entry/task-monitor-runtime.ts`                             |
| `native-harness-session-exit.ts`      | —      | delete-shim | Re-exports `daemon/entry/native-delivery/native-harness-session-exit.ts`      |
| `native-task-delivery-coordinator.ts` | —      | delete-shim | Re-exports `daemon/entry/native-delivery/native-task-delivery-coordinator.ts` |
| `native-turn-phase.ts`                | —      | delete-shim | Re-exports `daemon/entry/native-delivery/native-turn-phase.ts`                |
| `command-loop.ts`                     | —      | delete-shim | Re-exports `daemon/entry/command-dispatch.ts`                                 |
| `enhancer/job-subscriber.ts`          | —      | delete-shim | Re-exports `daemon/entry/enhancer-legacy/job-subscriber.ts`                   |
| `enhancer/start-subscriptions.ts`     | —      | delete-shim | Re-exports `daemon/entry/enhancer-legacy/start-subscriptions.ts`              |

---

## 2. `commands/machine/daemon-start/` — handler logic

> **Tests:** 19 `*.test.ts` files under `daemon-start/` are not listed below; they move with their source modules. `handlers/process/manager.spec.ts` and `handlers/process/state.spec.ts` are listed in §2a (Vitest specs).

### 2a. `handlers/`

| Current | Target | Verdict | Rationale |
| ------- | ------ | ------- | --------- |

| `handlers/command-runner.ts` | `daemon/entry/handlers/command-runner.ts` | consolidate | Daemon-runtime / daemon-start consumers only (`grep -rl` shows no harness-status/detection imports) |
| `handlers/daemon-restart-cleanup.ts` | `daemon/entry/handlers/daemon-restart-cleanup.ts` | consolidate | Daemon-runtime / daemon-start consumers only (`grep -rl` shows no harness-status/detection imports) |
| `handlers/daemon-startup-log.ts` | `daemon/entry/handlers/daemon-startup-log.ts` | consolidate | Daemon-runtime / daemon-start consumers only (`grep -rl` shows no harness-status/detection imports) |
| `handlers/orphan-tracker.ts` | `daemon/entry/handlers/orphan-tracker.ts` | consolidate | Daemon-runtime / daemon-start consumers only (`grep -rl` shows no harness-status/detection imports) |
| `handlers/ping.ts` | `daemon/entry/handlers/ping.ts` | consolidate | Daemon-runtime / daemon-start consumers only (`grep -rl` shows no harness-status/detection imports) |
| `handlers/process/command-run-subscription.ts` | `daemon/entry/handlers/process/command-run-subscription.ts` | consolidate | Daemon-runtime / daemon-start consumers only (`grep -rl` shows no harness-status/detection imports) |
| `handlers/process/killer.ts` | `daemon/entry/handlers/process/killer.ts` | consolidate | Daemon-runtime / daemon-start consumers only (`grep -rl` shows no harness-status/detection imports) |
| `handlers/process/log-observer-subscription.ts` | `daemon/entry/handlers/process/log-observer-subscription.ts` | consolidate | Daemon-runtime / daemon-start consumers only (`grep -rl` shows no harness-status/detection imports) |
| `handlers/process/log-observer-sync.ts` | `daemon/entry/handlers/process/log-observer-sync.ts` | consolidate | Daemon-runtime / daemon-start consumers only (`grep -rl` shows no harness-status/detection imports) |
| `handlers/process/manager.spec.ts` | `daemon/entry/handlers/process/manager.spec.ts` | consolidate | Vitest spec; moves with `manager.ts` / `state.ts` |
| `handlers/process/manager.ts` | `daemon/entry/handlers/process/manager.ts` | consolidate | Daemon-runtime / daemon-start consumers only (`grep -rl` shows no harness-status/detection imports) |
| `handlers/process/output-store.ts` | `daemon/entry/handlers/process/output-store.ts` | consolidate | Daemon-runtime / daemon-start consumers only (`grep -rl` shows no harness-status/detection imports) |
| `handlers/process/spawner.ts` | `daemon/entry/handlers/process/spawner.ts` | consolidate | Daemon-runtime / daemon-start consumers only (`grep -rl` shows no harness-status/detection imports) |
| `handlers/process/state.spec.ts` | `daemon/entry/handlers/process/state.spec.ts` | consolidate | Vitest spec; moves with `manager.ts` / `state.ts` |
| `handlers/process/state.ts` | `daemon/entry/handlers/process/state.ts` | consolidate | Daemon-runtime / daemon-start consumers only (`grep -rl` shows no harness-status/detection imports) |
| `handlers/state-recovery.ts` | `daemon/entry/handlers/state-recovery.ts` | consolidate | Daemon-runtime / daemon-start consumers only (`grep -rl` shows no harness-status/detection imports) |
| `handlers/status.ts` | `daemon/entry/handlers/status.ts` | consolidate | Daemon-runtime / daemon-start consumers only (`grep -rl` shows no harness-status/detection imports) |
| `handlers/stop-agent.ts` | `daemon/entry/handlers/stop-agent.ts` | consolidate | Daemon-runtime / daemon-start consumers only (`grep -rl` shows no harness-status/detection imports) |

### 2b. `direct-harness/

| Current                                       | Target                                                     | Verdict     | Rationale                                                                                           |
| --------------------------------------------- | ---------------------------------------------------------- | ----------- | --------------------------------------------------------------------------------------------------- |
| `direct-harness/command-processor.ts`         | `daemon/entry/direct-harness/command-processor.ts`         | consolidate | Daemon-runtime / daemon-start consumers only (`grep -rl` shows no harness-status/detection imports) |
| `direct-harness/harness-lifecycle-manager.ts` | `daemon/entry/direct-harness/harness-lifecycle-manager.ts` | consolidate | Daemon-runtime / daemon-start consumers only (`grep -rl` shows no harness-status/detection imports) |
| `direct-harness/idle-handler.ts`              | `daemon/entry/direct-harness/idle-handler.ts`              | consolidate | Daemon-runtime / daemon-start consumers only (`grep -rl` shows no harness-status/detection imports) |
| `direct-harness/prompt-drain.ts`              | `daemon/entry/direct-harness/prompt-drain.ts`              | consolidate | Daemon-runtime / daemon-start consumers only (`grep -rl` shows no harness-status/detection imports) |
| `direct-harness/session-processor.ts`         | `daemon/entry/direct-harness/session-processor.ts`         | consolidate | Daemon-runtime / daemon-start consumers only (`grep -rl` shows no harness-status/detection imports) |
| `direct-harness/shutdown-sessions.ts`         | `daemon/entry/direct-harness/shutdown-sessions.ts`         | consolidate | Daemon-runtime / daemon-start consumers only (`grep -rl` shows no harness-status/detection imports) |
| `direct-harness/start-subscriptions.ts`       | `daemon/entry/direct-harness/start-subscriptions.ts`       | consolidate | Daemon-runtime / daemon-start consumers only (`grep -rl` shows no harness-status/detection imports) |

### 2c. `agentic-query/

| Current                                | Target                                              | Verdict     | Rationale                                                                                           |
| -------------------------------------- | --------------------------------------------------- | ----------- | --------------------------------------------------------------------------------------------------- |
| `agentic-query/prompt-drain.ts`        | `daemon/entry/agentic-query/prompt-drain.ts`        | consolidate | Daemon-runtime / daemon-start consumers only (`grep -rl` shows no harness-status/detection imports) |
| `agentic-query/session-processor.ts`   | `daemon/entry/agentic-query/session-processor.ts`   | consolidate | Daemon-runtime / daemon-start consumers only (`grep -rl` shows no harness-status/detection imports) |
| `agentic-query/start-subscriptions.ts` | `daemon/entry/agentic-query/start-subscriptions.ts` | consolidate | Daemon-runtime / daemon-start consumers only (`grep -rl` shows no harness-status/detection imports) |
| `agentic-query/types.ts`               | `daemon/entry/agentic-query/types.ts`               | consolidate | Daemon-runtime / daemon-start consumers only (`grep -rl` shows no harness-status/detection imports) |

### 2d. `enhancer/` (overlap with `daemon/entry/enhancer-legacy/`)

| Current                  | Target | Verdict     | Rationale                                                                                        |
| ------------------------ | ------ | ----------- | ------------------------------------------------------------------------------------------------ |
| `job-subscriber.ts`      | —      | delete-shim | Thin re-export of `daemon/entry/enhancer-legacy/job-subscriber.ts` (real impl already in daemon) |
| `start-subscriptions.ts` | —      | delete-shim | Thin re-export of `daemon/entry/enhancer-legacy/start-subscriptions.ts`                          |

### 2e. `file-*` subscriptions and fulfillment

| Current                        | Target                                            | Verdict     | Rationale                                                                                           |
| ------------------------------ | ------------------------------------------------- | ----------- | --------------------------------------------------------------------------------------------------- |
| `file-content-classifier.ts`   | `daemon/entry/files/file-content-classifier.ts`   | consolidate | Daemon-runtime / daemon-start consumers only (`grep -rl` shows no harness-status/detection imports) |
| `file-content-fulfillment.ts`  | `daemon/entry/files/file-content-fulfillment.ts`  | consolidate | Daemon-runtime / daemon-start consumers only (`grep -rl` shows no harness-status/detection imports) |
| `file-content-subscription.ts` | `daemon/entry/files/file-content-subscription.ts` | consolidate | Daemon-runtime / daemon-start consumers only (`grep -rl` shows no harness-status/detection imports) |
| `file-tree-subscription.ts`    | `daemon/entry/files/file-tree-subscription.ts`    | consolidate | Daemon-runtime / daemon-start consumers only (`grep -rl` shows no harness-status/detection imports) |
| `file-write-errors.ts`         | `daemon/entry/files/file-write-errors.ts`         | consolidate | Daemon-runtime / daemon-start consumers only (`grep -rl` shows no harness-status/detection imports) |
| `file-write-fulfillment.ts`    | `daemon/entry/files/file-write-fulfillment.ts`    | consolidate | Daemon-runtime / daemon-start consumers only (`grep -rl` shows no harness-status/detection imports) |
| `file-write-subscription.ts`   | `daemon/entry/files/file-write-subscription.ts`   | consolidate | Daemon-runtime / daemon-start consumers only (`grep -rl` shows no harness-status/detection imports) |

### 2f. Root files

| Current                             | Target                                                      | Verdict          | Rationale                                                                                           |
| ----------------------------------- | ----------------------------------------------------------- | ---------------- | --------------------------------------------------------------------------------------------------- |
| `capabilities-snapshot.ts`          | `daemon/entry/capabilities-snapshot.ts`                     | consolidate      | Daemon-runtime / daemon-start consumers only (`grep -rl` shows no harness-status/detection imports) |
| `command-event-types.ts`            | `daemon/entry/command-event-types.ts`                       | consolidate      | Daemon-runtime / daemon-start consumers only (`grep -rl` shows no harness-status/detection imports) |
| `command-sync-heartbeat.ts`         | `daemon/entry/command-sync-heartbeat.ts`                    | consolidate      | Daemon-runtime / daemon-start consumers only (`grep -rl` shows no harness-status/detection imports) |
| `commit-detail-sync.ts`             | `daemon/entry/workspace-git/commit-detail-sync.ts`          | consolidate      | Daemon-runtime / daemon-start consumers only (`grep -rl` shows no harness-status/detection imports) |
| `daemon-layers.ts`                  | `daemon/entry/daemon-layers.ts`                             | consolidate      | Daemon-runtime / daemon-start consumers only (`grep -rl` shows no harness-status/detection imports) |
| `daemon-services.ts`                | `daemon/entry/daemon-services.ts`                           | consolidate+shim | Imported via `daemon-start/` path from daemon + tests; thin re-export until paths updated           |
| `deps.ts`                           | `daemon/entry/daemon-deps.ts`                               | consolidate      | Daemon-runtime / daemon-start consumers only (`grep -rl` shows no harness-status/detection imports) |
| `models-refresh.ts`                 | `daemon/entry/models-refresh.ts`                            | consolidate      | Daemon-runtime / daemon-start consumers only (`grep -rl` shows no harness-status/detection imports) |
| `refresh-models-outcome.ts`         | `daemon/entry/refresh-models-outcome.ts`                    | consolidate      | Daemon-runtime / daemon-start consumers only (`grep -rl` shows no harness-status/detection imports) |
| `restart-orchestrator-in-flight.ts` | `daemon/entry/restart-orchestrator-in-flight.ts`            | consolidate      | Daemon-runtime / daemon-start consumers only (`grep -rl` shows no harness-status/detection imports) |
| `restart-orchestrator.ts`           | `daemon/entry/restart-orchestrator.ts`                      | consolidate      | Daemon-runtime / daemon-start consumers only (`grep -rl` shows no harness-status/detection imports) |
| `role-delivery-state.ts`            | `daemon/entry/role-delivery-state.ts`                       | consolidate      | Daemon-runtime / daemon-start consumers only (`grep -rl` shows no harness-status/detection imports) |
| `types.ts`                          | `daemon/entry/daemon-types.ts`                              | consolidate+shim | Imported via `daemon-start/` path from daemon + tests; thin re-export until paths updated           |
| `utils.ts`                          | `daemon/entry/daemon-utils.ts`                              | consolidate      | Daemon-runtime / daemon-start consumers only (`grep -rl` shows no harness-status/detection imports) |
| `workspace-cache.ts`                | `daemon/entry/workspace-git/workspace-cache.ts`             | consolidate      | Daemon-runtime / daemon-start consumers only (`grep -rl` shows no harness-status/detection imports) |
| `workspace-list-subscription.ts`    | `daemon/entry/workspace-git/workspace-list-subscription.ts` | consolidate      | Daemon-runtime / daemon-start consumers only (`grep -rl` shows no harness-status/detection imports) |

### 2g. `shared-harness/

| Current                                         | Target                                                       | Verdict     | Rationale                                                                                           |
| ----------------------------------------------- | ------------------------------------------------------------ | ----------- | --------------------------------------------------------------------------------------------------- |
| `shared-harness/bind-turn-message-on-event.ts`  | `daemon/entry/shared-harness/bind-turn-message-on-event.ts`  | consolidate | Daemon-runtime / daemon-start consumers only (`grep -rl` shows no harness-status/detection imports) |
| `shared-harness/get-or-create-bound-harness.ts` | `daemon/entry/shared-harness/get-or-create-bound-harness.ts` | consolidate | Daemon-runtime / daemon-start consumers only (`grep -rl` shows no harness-status/detection imports) |
| `shared-harness/open-pending-session.ts`        | `daemon/entry/shared-harness/open-pending-session.ts`        | consolidate | Daemon-runtime / daemon-start consumers only (`grep -rl` shows no harness-status/detection imports) |
| `shared-harness/types.ts`                       | `daemon/entry/shared-harness/types.ts`                       | consolidate | Daemon-runtime / daemon-start consumers only (`grep -rl` shows no harness-status/detection imports) |

### 2h. `testing/

| Current                          | Target                                        | Verdict     | Rationale                                                                                           |
| -------------------------------- | --------------------------------------------- | ----------- | --------------------------------------------------------------------------------------------------- |
| `testing/index.ts`               | `daemon/entry/testing/index.ts`               | consolidate | Daemon-runtime / daemon-start consumers only (`grep -rl` shows no harness-status/detection imports) |
| `testing/mock-daemon-context.ts` | `daemon/entry/testing/mock-daemon-context.ts` | consolidate | Daemon-runtime / daemon-start consumers only (`grep -rl` shows no harness-status/detection imports) |
| `testing/mock-daemon-deps.ts`    | `daemon/entry/testing/mock-daemon-deps.ts`    | consolidate | Daemon-runtime / daemon-start consumers only (`grep -rl` shows no harness-status/detection imports) |

---

## 3. `events/daemon/

| Current                             | Target                                                  | Verdict     | Rationale                                                             |
| ----------------------------------- | ------------------------------------------------------- | ----------- | --------------------------------------------------------------------- |
| `event-bus.ts`                      | `daemon/entry/events/event-bus.ts`                      | consolidate | Importers: init-daemon.ts, daemon-services.ts, mock-daemon-context.ts |
| `register-listeners.ts`             | `daemon/entry/events/register-listeners.ts`             | consolidate | Importers: init-daemon.ts                                             |
| `agent/on-agent-exited.ts`          | `daemon/entry/events/agent/on-agent-exited.ts`          | consolidate | Importers: register-listeners.ts                                      |
| `agent/on-agent-started.ts`         | `daemon/entry/events/agent/on-agent-started.ts`         | consolidate | Importers: register-listeners.ts                                      |
| `agent/on-agent-stopped.ts`         | `daemon/entry/events/agent/on-agent-stopped.ts`         | consolidate | Importers: register-listeners.ts                                      |
| `agent/on-request-restart-agent.ts` | `daemon/entry/events/agent/on-request-restart-agent.ts` | consolidate | Importers: command-dispatch.ts                                        |
| `agent/on-request-start-agent.ts`   | `daemon/entry/events/agent/on-request-start-agent.ts`   | consolidate | Importers: command-dispatch.ts                                        |
| `agent/on-request-stop-agent.ts`    | `daemon/entry/events/agent/on-request-stop-agent.ts`    | consolidate | Importers: command-dispatch.ts                                        |

---

## 4. `infrastructure/daemon/

| Current                | Target                                             | Verdict     | Rationale                                                        |
| ---------------------- | -------------------------------------------------- | ----------- | ---------------------------------------------------------------- |
| `fatal-error-guard.ts` | `daemon/infrastructure/local/fatal-error-guard.ts` | consolidate | Sole importer: `daemon/infrastructure/local/harness/registry.ts` |

---

## 5. `infrastructure/git/

| Current                 | Target                                            | Verdict     | Rationale                                                                       |
| ----------------------- | ------------------------------------------------- | ----------- | ------------------------------------------------------------------------------- |
| `git-reader.ts`         | `daemon/infrastructure/git/git-reader.ts`         | consolidate | Importers: `daemon/entry/workspace-git/*`, `daemon-start/commit-detail-sync.ts` |
| `git-writer.ts`         | `daemon/infrastructure/git/git-writer.ts`         | consolidate | Importers: `daemon/entry/workspace-git/*`, `daemon-start/commit-detail-sync.ts` |
| `git-state-pipeline.ts` | `daemon/infrastructure/git/git-state-pipeline.ts` | consolidate | Importers: `daemon/entry/workspace-git/*`, `daemon-start/commit-detail-sync.ts` |
| `run-command.ts`        | `daemon/infrastructure/git/run-command.ts`        | consolidate | Importers: `daemon/entry/workspace-git/*`, `daemon-start/commit-detail-sync.ts` |
| `request-types.ts`      | `daemon/infrastructure/git/request-types.ts`      | consolidate | Importers: `daemon/entry/workspace-git/*`, `daemon-start/commit-detail-sync.ts` |
| `result-predicates.ts`  | `daemon/infrastructure/git/result-predicates.ts`  | consolidate | Importers: `daemon/entry/workspace-git/*`, `daemon-start/commit-detail-sync.ts` |
| `types.ts`              | `daemon/infrastructure/git/types.ts`              | consolidate | Importers: `daemon/entry/workspace-git/*`, `daemon-start/commit-detail-sync.ts` |
| `index.ts`              | `daemon/infrastructure/git/index.ts`              | consolidate | Importers: `daemon/entry/workspace-git/*`, `daemon-start/commit-detail-sync.ts` |

---

## 6. `infrastructure/services/agent-process-manager/

| Current                              | Target                                                                    | Verdict     | Rationale                                                                                          |
| ------------------------------------ | ------------------------------------------------------------------------- | ----------- | -------------------------------------------------------------------------------------------------- |
| `agent-process-manager.ts`           | `daemon/infrastructure/agent-process-manager/agent-process-manager.ts`    | consolidate | Core process manager; importers: daemon-services, native-delivery, remote-agents                   |
| `turn-completed-backend.ts`          | `daemon/infrastructure/agent-process-manager/turn-completed-backend.ts`   | consolidate | Turn completion port; importer: agent-process-manager.ts                                           |
| `turn-end-queue.ts`                  | `daemon/infrastructure/agent-process-manager/turn-end-queue.ts`           | consolidate | Turn end queue; importer: agent-process-manager.ts                                                 |
| `domain/harness-activity-emitter.ts` | `daemon/infrastructure/agent-process-manager/harness-activity-emitter.ts` | consolidate | Importers: `remote-agent-service.ts`, `native-spawn-presence.ts` — move with agent-process-manager |

---

## 7. `domain/native-integration/` + `domain/harness-activity-emitter.ts

| Current                              | Target                                             | Verdict     | Rationale                                                            |
| ------------------------------------ | -------------------------------------------------- | ----------- | -------------------------------------------------------------------- |
| `native-integration/index.ts`        | `daemon/domain/native-integration/index.ts`        | consolidate | Re-exports backend `isNativeHarness` + local predicates/spawn-policy |
| `native-integration/predicates.ts`   | `daemon/domain/native-integration/predicates.ts`   | consolidate | Native harness predicates; importers: native-delivery, task-monitor  |
| `native-integration/spawn-policy.ts` | `daemon/domain/native-integration/spawn-policy.ts` | consolidate | Spawn policy; importers: remote-agents agent services                |

---

## 8. `infrastructure/harnesses/

| Current                     | Target                                               | Verdict     | Rationale                                                                  |
| --------------------------- | ---------------------------------------------------- | ----------- | -------------------------------------------------------------------------- |
| `claude-sdk/index.ts`       | —                                                    | delete-shim | Re-exports `daemon/infrastructure/local/harness/` adapter or registry      |
| `cursor-sdk/index.ts`       | —                                                    | delete-shim | Re-exports `daemon/infrastructure/local/harness/` adapter or registry      |
| `opencode-sdk/index.ts`     | —                                                    | delete-shim | Re-exports `daemon/infrastructure/local/harness/` adapter or registry      |
| `pi-sdk/index.ts`           | —                                                    | delete-shim | Re-exports `daemon/infrastructure/local/harness/` adapter or registry      |
| `registry.ts`               | —                                                    | delete-shim | Re-exports `daemon/infrastructure/local/harness/` adapter or registry      |
| `shared-chunk-extractor.ts` | —                                                    | delete-shim | Re-exports `daemon/infrastructure/local/harness/` adapter or registry      |
| `harness-key.ts`            | `daemon/infrastructure/local/harness/harness-key.ts` | consolidate | Importers: daemon-start prompt drains + shared-harness (no harness-status) |

---

## 9. `infrastructure/services/remote-agents/

> **Shared consumers:** `commands/machine/harness-status.ts`, `infrastructure/machine/detection.ts` (import `index`, `base-cli-agent-service`, `detection-result`)

| Current                                      | Target                                                                                    | Verdict          | Rationale                                                                         |
| -------------------------------------------- | ----------------------------------------------------------------------------------------- | ---------------- | --------------------------------------------------------------------------------- |
| `agent-log-format.ts`                        | `daemon/infrastructure/local/harness/services/agent-log-format.ts`                        | consolidate      | Harness service plumbing; daemon registry is primary consumer                     |
| `assistant-text-capture.ts`                  | `daemon/infrastructure/local/harness/services/assistant-text-capture.ts`                  | consolidate      | Harness service plumbing; daemon registry is primary consumer                     |
| `base-cli-agent-service.ts`                  | `daemon/infrastructure/local/harness/services/base-cli-agent-service.ts`                  | consolidate+shim | Also used by harness-status / machine detection — keep thin re-export at old path |
| `detection-result.ts`                        | `daemon/infrastructure/local/harness/services/detection-result.ts`                        | consolidate+shim | Also used by harness-status / machine detection — keep thin re-export at old path |
| `index.ts`                                   | `daemon/infrastructure/local/harness/services/index.ts`                                   | consolidate+shim | Also used by harness-status / machine detection — keep thin re-export at old path |
| `init-registry.ts`                           | `daemon/infrastructure/local/harness/services/init-registry.ts`                           | consolidate+shim | Also used by harness-status / machine detection — keep thin re-export at old path |
| `line-stream-reader.ts`                      | `daemon/infrastructure/local/harness/services/line-stream-reader.ts`                      | consolidate      | Harness service plumbing; daemon registry is primary consumer                     |
| `native-spawn-presence.ts`                   | `daemon/infrastructure/local/harness/services/native-spawn-presence.ts`                   | consolidate      | Harness service plumbing; daemon registry is primary consumer                     |
| `native-stream-adapter-base.ts`              | `daemon/infrastructure/local/harness/services/native-stream-adapter-base.ts`              | consolidate      | Harness service plumbing; daemon registry is primary consumer                     |
| `registry.ts`                                | `daemon/infrastructure/local/harness/services/registry.ts`                                | consolidate+shim | Also used by harness-status / machine detection — keep thin re-export at old path |
| `remote-agent-service.ts`                    | `daemon/infrastructure/local/harness/services/remote-agent-service.ts`                    | consolidate      | Harness service plumbing; daemon registry is primary consumer                     |
| `spawn-prompt.ts`                            | `daemon/infrastructure/local/harness/services/spawn-prompt.ts`                            | consolidate      | Harness service plumbing; daemon registry is primary consumer                     |
| `tap-process-stream-writes.ts`               | `daemon/infrastructure/local/harness/services/tap-process-stream-writes.ts`               | consolidate      | Harness service plumbing; daemon registry is primary consumer                     |
| `wire-native-stream-adapter.ts`              | `daemon/infrastructure/local/harness/services/wire-native-stream-adapter.ts`              | consolidate      | Harness service plumbing; daemon registry is primary consumer                     |
| `with-timeout.ts`                            | `daemon/infrastructure/local/harness/services/with-timeout.ts`                            | consolidate      | Harness service plumbing; daemon registry is primary consumer                     |
| `cursor-sdk/cursor-models.ts`                | `daemon/infrastructure/local/harness/services/cursor-sdk/cursor-models.ts`                | consolidate      | Native SDK services; primary consumers are daemon harness adapters                |
| `cursor-sdk/cursor-sdk-agent-service.ts`     | `daemon/infrastructure/local/harness/services/cursor-sdk/cursor-sdk-agent-service.ts`     | consolidate      | Native SDK services; primary consumers are daemon harness adapters                |
| `cursor-sdk/cursor-sdk-package.ts`           | `daemon/infrastructure/local/harness/services/cursor-sdk/cursor-sdk-package.ts`           | consolidate      | Native SDK services; primary consumers are daemon harness adapters                |
| `cursor-sdk/cursor-sdk-session-cleanup.ts`   | `daemon/infrastructure/local/harness/services/cursor-sdk/cursor-sdk-session-cleanup.ts`   | consolidate      | Native SDK services; primary consumers are daemon harness adapters                |
| `cursor-sdk/cursor-sdk-stream-adapter.ts`    | `daemon/infrastructure/local/harness/services/cursor-sdk/cursor-sdk-stream-adapter.ts`    | consolidate      | Native SDK services; primary consumers are daemon harness adapters                |
| `cursor-sdk/cursor-sdk-stream-fallback.ts`   | `daemon/infrastructure/local/harness/services/cursor-sdk/cursor-sdk-stream-fallback.ts`   | consolidate      | Native SDK services; primary consumers are daemon harness adapters                |
| `cursor-sdk/index.ts`                        | `daemon/infrastructure/local/harness/services/cursor-sdk/index.ts`                        | consolidate      | Native SDK services; primary consumers are daemon harness adapters                |
| `copilot/copilot-agent-service.ts`           | `daemon/infrastructure/local/harness/services/copilot/copilot-agent-service.ts`           | consolidate+shim | Also used by harness-status / machine detection — keep thin re-export at old path |
| `copilot/copilot-stream-reader.ts`           | `daemon/infrastructure/local/harness/services/copilot/copilot-stream-reader.ts`           | consolidate+shim | Also used by harness-status / machine detection — keep thin re-export at old path |
| `copilot/index.ts`                           | `daemon/infrastructure/local/harness/services/copilot/index.ts`                           | consolidate+shim | Also used by harness-status / machine detection — keep thin re-export at old path |
| `cursor/cursor-agent-service.ts`             | `daemon/infrastructure/local/harness/services/cursor/cursor-agent-service.ts`             | consolidate+shim | Also used by harness-status / machine detection — keep thin re-export at old path |
| `cursor/cursor-stream-reader.ts`             | `daemon/infrastructure/local/harness/services/cursor/cursor-stream-reader.ts`             | consolidate+shim | Also used by harness-status / machine detection — keep thin re-export at old path |
| `cursor/index.ts`                            | `daemon/infrastructure/local/harness/services/cursor/index.ts`                            | consolidate+shim | Also used by harness-status / machine detection — keep thin re-export at old path |
| `claude-sdk/claude-sdk-agent-service.ts`     | `daemon/infrastructure/local/harness/services/claude-sdk/claude-sdk-agent-service.ts`     | consolidate      | Native SDK services; primary consumers are daemon harness adapters                |
| `claude-sdk/claude-sdk-package.ts`           | `daemon/infrastructure/local/harness/services/claude-sdk/claude-sdk-package.ts`           | consolidate      | Native SDK services; primary consumers are daemon harness adapters                |
| `claude-sdk/claude-sdk-stream-adapter.ts`    | `daemon/infrastructure/local/harness/services/claude-sdk/claude-sdk-stream-adapter.ts`    | consolidate      | Native SDK services; primary consumers are daemon harness adapters                |
| `claude-sdk/index.ts`                        | `daemon/infrastructure/local/harness/services/claude-sdk/index.ts`                        | consolidate      | Native SDK services; primary consumers are daemon harness adapters                |
| `pi-sdk/index.ts`                            | `daemon/infrastructure/local/harness/services/pi-sdk/index.ts`                            | consolidate      | Native SDK services; primary consumers are daemon harness adapters                |
| `pi-sdk/pi-sdk-agent-service.ts`             | `daemon/infrastructure/local/harness/services/pi-sdk/pi-sdk-agent-service.ts`             | consolidate      | Native SDK services; primary consumers are daemon harness adapters                |
| `pi-sdk/pi-sdk-package.ts`                   | `daemon/infrastructure/local/harness/services/pi-sdk/pi-sdk-package.ts`                   | consolidate      | Native SDK services; primary consumers are daemon harness adapters                |
| `pi-sdk/pi-sdk-stream-adapter.ts`            | `daemon/infrastructure/local/harness/services/pi-sdk/pi-sdk-stream-adapter.ts`            | consolidate      | Native SDK services; primary consumers are daemon harness adapters                |
| `claude/claude-code-agent-service.ts`        | `daemon/infrastructure/local/harness/services/claude/claude-code-agent-service.ts`        | consolidate+shim | Also used by harness-status / machine detection — keep thin re-export at old path |
| `claude/claude-models.ts`                    | `daemon/infrastructure/local/harness/services/claude/claude-models.ts`                    | consolidate+shim | Also used by harness-status / machine detection — keep thin re-export at old path |
| `claude/claude-stream-reader.ts`             | `daemon/infrastructure/local/harness/services/claude/claude-stream-reader.ts`             | consolidate+shim | Also used by harness-status / machine detection — keep thin re-export at old path |
| `claude/index.ts`                            | `daemon/infrastructure/local/harness/services/claude/index.ts`                            | consolidate+shim | Also used by harness-status / machine detection — keep thin re-export at old path |
| `commandcode/command-code-agent-service.ts`  | `daemon/infrastructure/local/harness/services/commandcode/command-code-agent-service.ts`  | consolidate+shim | Also used by harness-status / machine detection — keep thin re-export at old path |
| `commandcode/command-code-stream-reader.ts`  | `daemon/infrastructure/local/harness/services/commandcode/command-code-stream-reader.ts`  | consolidate+shim | Also used by harness-status / machine detection — keep thin re-export at old path |
| `commandcode/index.ts`                       | `daemon/infrastructure/local/harness/services/commandcode/index.ts`                       | consolidate+shim | Also used by harness-status / machine detection — keep thin re-export at old path |
| `pi/index.ts`                                | `daemon/infrastructure/local/harness/services/pi/index.ts`                                | consolidate+shim | Also used by harness-status / machine detection — keep thin re-export at old path |
| `pi/pi-agent-service.ts`                     | `daemon/infrastructure/local/harness/services/pi/pi-agent-service.ts`                     | consolidate+shim | Also used by harness-status / machine detection — keep thin re-export at old path |
| `pi/pi-rpc-reader.ts`                        | `daemon/infrastructure/local/harness/services/pi/pi-rpc-reader.ts`                        | consolidate+shim | Also used by harness-status / machine detection — keep thin re-export at old path |
| `opencode-sdk/compose-system-prompt.ts`      | `daemon/infrastructure/local/harness/services/opencode-sdk/compose-system-prompt.ts`      | consolidate      | Native SDK services; primary consumers are daemon harness adapters                |
| `opencode-sdk/index.ts`                      | `daemon/infrastructure/local/harness/services/opencode-sdk/index.ts`                      | consolidate      | Native SDK services; primary consumers are daemon harness adapters                |
| `opencode-sdk/node-streams.ts`               | `daemon/infrastructure/local/harness/services/opencode-sdk/node-streams.ts`               | consolidate      | Native SDK services; primary consumers are daemon harness adapters                |
| `opencode-sdk/opencode-sdk-agent-service.ts` | `daemon/infrastructure/local/harness/services/opencode-sdk/opencode-sdk-agent-service.ts` | consolidate      | Native SDK services; primary consumers are daemon harness adapters                |
| `opencode-sdk/opencode-session-events.ts`    | `daemon/infrastructure/local/harness/services/opencode-sdk/opencode-session-events.ts`    | consolidate      | Native SDK services; primary consumers are daemon harness adapters                |
| `opencode-sdk/opencode-session-status.ts`    | `daemon/infrastructure/local/harness/services/opencode-sdk/opencode-session-status.ts`    | consolidate      | Native SDK services; primary consumers are daemon harness adapters                |
| `opencode-sdk/parse-listening-url.ts`        | `daemon/infrastructure/local/harness/services/opencode-sdk/parse-listening-url.ts`        | consolidate      | Native SDK services; primary consumers are daemon harness adapters                |
| `opencode-sdk/pure.ts`                       | `daemon/infrastructure/local/harness/services/opencode-sdk/pure.ts`                       | consolidate      | Native SDK services; primary consumers are daemon harness adapters                |
| `opencode-sdk/select-agent.ts`               | `daemon/infrastructure/local/harness/services/opencode-sdk/select-agent.ts`               | consolidate      | Native SDK services; primary consumers are daemon harness adapters                |
| `opencode-sdk/session-event-forwarder.ts`    | `daemon/infrastructure/local/harness/services/opencode-sdk/session-event-forwarder.ts`    | consolidate      | Native SDK services; primary consumers are daemon harness adapters                |
| `opencode-sdk/session-metadata-store.ts`     | `daemon/infrastructure/local/harness/services/opencode-sdk/session-metadata-store.ts`     | consolidate      | Native SDK services; primary consumers are daemon harness adapters                |
| `opencode-sdk/stderr-line-buffer.ts`         | `daemon/infrastructure/local/harness/services/opencode-sdk/stderr-line-buffer.ts`         | consolidate      | Native SDK services; primary consumers are daemon harness adapters                |
| `opencode/binary-agent-service.ts`           | `daemon/infrastructure/local/harness/services/opencode/binary-agent-service.ts`           | consolidate+shim | Also used by harness-status / machine detection — keep thin re-export at old path |
| `opencode/index.ts`                          | `daemon/infrastructure/local/harness/services/opencode/index.ts`                          | consolidate+shim | Also used by harness-status / machine detection — keep thin re-export at old path |
| `opencode/opencode-agent-service.ts`         | `daemon/infrastructure/local/harness/services/opencode/opencode-agent-service.ts`         | consolidate+shim | Also used by harness-status / machine detection — keep thin re-export at old path |

---

## 10. Explicitly kept outside `daemon/`

| Path                                     | Verdict | Rationale                                                         |
| ---------------------------------------- | ------- | ----------------------------------------------------------------- |
| `infrastructure/incremental-sync/`       | keep    | Shared transport library; daemon subscribers + other CLI features |
| `infrastructure/convex/client.ts`        | keep    | Shared Convex WS client for CLI                                   |
| `infrastructure/lifecycle-heartbeat.ts`  | keep    | Used by all CLI commands with `--chatroom-id`                     |
| `infrastructure/retry-queue.ts`          | keep    | Shared retry primitive; not daemon-exclusive                      |
| `commands/machine/daemon-start/index.ts` | keep    | CLI entry point (`startDaemon` delegate); may slim to 3-line shim |

## 11. Deferred consolidation candidates

| Path                                             | Target                                              | Verdict | Rationale                                                                     |
| ------------------------------------------------ | --------------------------------------------------- | ------- | ----------------------------------------------------------------------------- |
| `daemon/entry/enhancer-legacy/*` (5 `.ts` files) | `daemon/entry/enhancer/`                            | defer   | Already in daemon; rename after `daemon-start/enhancer/` shims deleted        |
| `infrastructure/services/workspace/*`            | —                                                   | defer   | File-tree/workspace I/O shared beyond daemon; file subscriptions depend on it |
| `infrastructure/services/agent-lifecycle/*`      | `daemon/infrastructure/agent-lifecycle/` (optional) | defer   | Coupled to agent-process-manager + remote-agents; needs boundary decision     |

---

## Open decisions

- [ ] **`remote-agents/` registry:** Move entire tree to `daemon/infrastructure/local/harness/services/` with re-exports at `infrastructure/services/remote-agents/` for `harness-status` / `detection`, or keep registry at infrastructure and only move native SDK subsets? (Phase 8 — **defer** until import strategy chosen)
- [ ] **`daemon-start/index.ts` path:** Keep `commands/machine/daemon-start/` vs rename to `commands/machine/daemon/` after consolidation phases complete? (**defer**)
- [ ] **`enhancer-legacy/` naming:** Rename `daemon/entry/enhancer-legacy/` → `daemon/entry/enhancer/` after deleting `daemon-start/enhancer/` shims, or merge folders? (**defer**)
- [ ] **`agent-lifecycle/` coupling:** `infrastructure/services/agent-lifecycle/` is consumed by agent-process-manager and remote-agents — consolidate into daemon with shims or leave as shared infrastructure? (**defer**)
