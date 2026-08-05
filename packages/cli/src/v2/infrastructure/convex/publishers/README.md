# Convex publishers (v2 daemon)

**Outbound only.** Accept `OutboundEvent`, map to Convex mutations.

## Belongs here

- `createXxxPublisher(deps): { publish(event: OutboundEvent): Promise<void> }`
- Idempotent mutation calls, error translation to domain-neutral results

## Does not belong here

| Kind                     | Home instead                  |
| ------------------------ | ----------------------------- |
| When to publish (policy) | `domain/usecase/`             |
| Inbound subscriptions    | `convex/subscribers/`         |
| Routing table            | `entry/publisher-registry.ts` |

## Stub files (scaffold)

| File                      | Outbound event types (typical) |
| ------------------------- | ------------------------------ |
| `assigned-task-status.ts` | `task.status`                  |
| `capabilities.ts`         | `capabilities.updated`         |
| `command-result.ts`       | `command.result`               |
| `daemon-heartbeat.ts`     | `heartbeat`                    |
| `git-state.ts`            | `git.state`                    |
| `harness-fingerprint.ts`  | harness metadata               |
| `models.ts`               | `models.updated`               |
| `session-lifecycle.ts`    | `session.lifecycle`            |
| `turn-output.ts`          | `turn.chunk`, `turn.completed` |
| `workspace-commands.ts`   | `workspace.commands`           |

Note: `harness.stream` may fan out to persistence + local-web WebSocket in addition to Convex projection.
