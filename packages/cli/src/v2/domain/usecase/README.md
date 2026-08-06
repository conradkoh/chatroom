# Domain use cases (v2 daemon)

One orchestration per file. Ports co-located as `export interface XxxPort`.

## Belongs here

- Single responsibility orchestration (`deliverAssignedTask`, `openHarnessSession`, …)
- `export interface XxxPort` dependency interfaces in the same file
- Pure policy helpers inline (no `policies/` folder)
- Co-located tests: `*.test.ts`

## Does not belong here

| Kind                          | Home instead                             |
| ----------------------------- | ---------------------------------------- |
| Convex subscribe loops        | `infrastructure/convex/subscribers/`     |
| Convex mutations              | `infrastructure/convex/publishers/`      |
| Effect layers / daemon-layers | Replaced by `entry/deps.ts`              |
| Harness SDK implementations   | `infrastructure/local/harness/` (future) |

## Legacy migration map

| v2 file                            | Legacy source                                               |
| ---------------------------------- | ----------------------------------------------------------- |
| `deliver-assigned-task.ts`         | `daemon-start/task-monitor.ts`                              | stub — boundary mapper in slice #7     |
| `handle-assigned-task-inbound.ts`  | `v2/infrastructure/convex/subscribers/assigned-task-*`      | **done** — router hook; deliver later  |
| `handle-direct-harness-inbound.ts` | `v2/infrastructure/convex/subscribers/direct-harness-*`     | **done** — router hook; process later  |
| `handle-command-event.ts`          | `daemon-start/command-loop.ts`                              |
| `handle-command-inbound.ts`        | `v2/infrastructure/convex/subscribers/command-*`            | **done** — router hook; dispatch later |
| `handle-turn-completed.ts`         | `domain/agent-lifecycle/use-cases/handle-turn-completed.ts` | **done**                               |
| `open-harness-session.ts`          | `domain/direct-harness/usecases/open-session.ts`            | **done**                               |
| `resume-harness-session.ts`        | `domain/direct-harness/usecases/resume-session.ts`          | **done**                               |
| `close-harness-session.ts`         | `domain/direct-harness/usecases/close-session.ts`           | **done**                               |
| `update-harness-capabilities.ts`   | `domain/direct-harness/usecases/update-capabilities.ts`     | **done**                               |
| `fulfill-file-content-request.ts`  | `daemon-start/file-content-fulfillment.ts`                  |
| `fulfill-file-tree-request.ts`     | `daemon-start/file-tree-subscription.ts`                    |
| `fulfill-file-write-request.ts`    | `daemon-start/file-write-fulfillment.ts`                    |
| `fulfill-git-request.ts`           | `daemon-start/git-subscription.ts`                          |
| `process-enhancer-job.ts`          | `daemon-start/enhancer/job-subscriber.ts`                   |
| `process-agentic-query-prompt.ts`  | `daemon-start/agentic-query/prompt-subscriber.ts`           |
| `process-direct-harness-prompt.ts` | `daemon-start/direct-harness/prompt-subscriber.ts`          |
| `recover-agent-state.ts`           | `daemon-start/handlers/state-recovery.ts`                   |
| `refresh-machine-capabilities.ts`  | `daemon-start/models-refresh.ts`                            |
| `restart-agent.ts`                 | `events/daemon/agent/on-request-restart-agent.ts`           |
| `start-agent.ts`                   | `events/daemon/agent/on-request-start-agent.ts`             |
| `stop-agent.ts`                    | `events/daemon/agent/on-request-stop-agent.ts`              |
| `sync-git-state.ts`                | `daemon-start/git-heartbeat.ts`                             |
| `update-workspace-list.ts`         | `daemon-start/workspace-list-subscription.ts`               |

## Assigned-task boundary (done)

| File                                          | Role                                        |
| --------------------------------------------- | ------------------------------------------- |
| `infrastructure/mappers/map-assigned-task.ts` | Backend → v2 AssignedTask at infra boundary |

## Agent-lifecycle policies (done)

| v2 file                              | Legacy source                                                        |
| ------------------------------------ | -------------------------------------------------------------------- |
| `transition-agent-slot.ts`           | `domain/agent-lifecycle/policies/slot-transitions.ts`                |
| `decide-restart-after-exit.ts`       | `domain/agent-lifecycle/policies/restart-decision.ts`                |
| `decide-resume-path.ts`              | `domain/agent-lifecycle/policies/decide-resume-path.ts`              |
| `preserve-harness-session.ts`        | `domain/agent-lifecycle/policies/preserve-session.ts`                |
| `append-recent-log-line.ts`          | `domain/agent-lifecycle/policies/append-recent-log-line.ts`          |
| `detect-terminal-provider-error.ts`  | `domain/agent-lifecycle/policies/terminal-provider-error.ts`         |
| `detect-cursor-sdk-run-error.ts`     | `domain/agent-lifecycle/policies/cursor-sdk-run-error.ts`            |
| `cursor-sdk-session-reopen-retry.ts` | `domain/agent-lifecycle/policies/cursor-sdk-session-reopen-retry.ts` |
| `classify-resume-storm-reason.ts`    | `domain/agent-lifecycle/policies/classify-resume-storm-reason.ts`    |

Entity: `resume-storm.ts` (`ResumeStormReason`) — was backend import in classify-resume-storm-reason.

Entity: `native-turn-phase.ts` (`NativeTurnPhase`) — SSOT for turn phase type; `daemon-start/native-turn-phase.ts` re-exports.

## Predicates slice (done)

| v2 file               | Legacy source                                     |
| --------------------- | ------------------------------------------------- |
| `check-agent-slot.ts` | `domain/agent-lifecycle/predicates/agent-slot.ts` |

## Turn-completion slice (done)

| v2 file                    | Legacy source                                               |
| -------------------------- | ----------------------------------------------------------- |
| `handle-turn-completed.ts` | `domain/agent-lifecycle/use-cases/handle-turn-completed.ts` |
| `abort-resume-storm.ts`    | `domain/agent-lifecycle/policies/abort-resume-storm.ts`     |

### Port co-location (turn-completion slice)

| Port                   | v2 home                    |
| ---------------------- | -------------------------- |
| `ResumeStormTracker`   | `handle-turn-completed.ts` |
| `ResumeStormCheck`     | `handle-turn-completed.ts` |
| `TurnCompletedBackend` | `handle-turn-completed.ts` |

## Port co-location (direct-harness slice)

| Port                    | v2 home                          |
| ----------------------- | -------------------------------- |
| `SessionRepository`     | `open-harness-session.ts`        |
| `OutputRepository`      | `open-harness-session.ts`        |
| `OutputChunk`           | `open-harness-session.ts`        |
| `JournalFactory`        | `open-harness-session.ts`        |
| `SessionJournal`        | `open-harness-session.ts`        |
| `CapabilitiesPublisher` | `update-harness-capabilities.ts` |
