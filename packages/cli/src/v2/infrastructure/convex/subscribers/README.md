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
| `command-events.ts`         | `daemon-start/command-loop.ts`                     |
| `direct-harness-session.ts` | `daemon-start/direct-harness/`                     |
| `direct-harness-prompt.ts`  | `daemon-start/direct-harness/prompt-subscriber.ts` |
| `direct-harness-command.ts` | `daemon-start/direct-harness/`                     |
| `agentic-query-session.ts`  | `daemon-start/agentic-query/`                      |
| `agentic-query-prompt.ts`   | `daemon-start/agentic-query/prompt-subscriber.ts`  |
| `enhancer-job.ts`           | `daemon-start/enhancer/job-subscriber.ts`          |
| `git-request.ts`            | `daemon-start/git-subscription.ts`                 |
| `file-tree-request.ts`      | `daemon-start/file-tree-subscription.ts`           |
| `file-content-request.ts`   | `daemon-start/file-content-subscription.ts`        |
| `file-write-request.ts`     | `daemon-start/file-write-subscription.ts`          |
| `workspace-list.ts`         | `daemon-start/workspace-list-subscription.ts`      |
| `command-run.ts`            | `daemon-start/` command run feeds                  |
