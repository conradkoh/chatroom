# Convex subscribers (v2 daemon)

**Inbound only.** Map Convex transport payloads → `InboundEvent`, then call `onEvent`.

## Belongs here

- `startXxxSubscriber(deps, onEvent: (e: InboundEvent) => void): { stop(): void }`
- Normalization from Convex row shapes to entity/event types
- Wiring to `infrastructure/incremental-sync/` for long-lived feeds

## Does not belong here

| Kind                   | Home instead                   |
| ---------------------- | ------------------------------ |
| Business decisions     | `domain/usecase/`              |
| Outbound mutations     | `convex/publishers/`           |
| Registry orchestration | `entry/subscriber-registry.ts` |

## Stub files (scaffold)

| File                        | Legacy direction                                   | Status   |
| --------------------------- | -------------------------------------------------- | -------- |
| `assigned-task-signals.ts`  | `daemon-start/task-monitor.ts`                     | **done** |
| `assigned-task-presence.ts` | `daemon-start/task-monitor.ts`                     | **done** |
| `command-events.ts`         | `daemon-start/command-loop.ts`                     | **done** |
| `direct-harness-session.ts` | `daemon-start/direct-harness/`                     | **done** |
| `direct-harness-prompt.ts`  | `daemon-start/direct-harness/prompt-subscriber.ts` | **done** |
| `direct-harness-command.ts` | `daemon-start/direct-harness/`                     | **done** |
| `agentic-query-session.ts`  | `daemon-start/agentic-query/`                      | **done** |
| `agentic-query-prompt.ts`   | `daemon-start/agentic-query/prompt-subscriber.ts`  | **done** |
| `enhancer-job.ts`           | `daemon-start/enhancer/job-subscriber.ts`          | **done** |
| `git-request.ts`            | `daemon-start/git-subscription.ts`                 | **done** |
| `file-tree-request.ts`      | `daemon-start/file-tree-subscription.ts`           | **done** |
| `file-content-request.ts`   | `daemon-start/file-content-subscription.ts`        | **done** |
| `file-write-request.ts`     | `daemon-start/file-write-subscription.ts`          | **done** |
| `workspace-list.ts`         | `daemon-start/workspace-list-subscription.ts`      | **done** |
| `command-run.ts`            | `daemon-start/` command run feeds                  | **done** |

## P5 — orchestration subscriber shrink

When `DAEMON_ORCHESTRATION_P5` is enabled, the daemon registers **inbound-only**
(user-intent) subscribers — see `infrastructure/inbound/convex/subscriber-registry.ts`.
The following **orchestration subscribers are NOT registered** (files remain for the
flag-off path and reference):

| File                        | Reason removed                                              |
| --------------------------- | ----------------------------------------------------------- |
| `assigned-task-signals.ts`  | Daemon no longer subscribes to self-projected task state    |
| `assigned-task-presence.ts` | P2 cutover + P3/P4 local paths replace presence feed        |
| `enhancer-job.ts`           | P4 local SQLite enhancer queue replaces Convex pending poll |

User-intent subscribers (git, files, workspace list, webapp commands, direct
harness sessions, agentic queries) remain registered in both modes.
