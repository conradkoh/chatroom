# Domain use cases (daemon module)

One orchestration per file. Ports co-located as `export interface XxxPort`.

## Belongs here

- Single responsibility orchestration (`deliverAssignedTask`, `openHarnessSession`, …)
- `export interface XxxPort` dependency interfaces in the same file
- Pure policy helpers inline (no `policies/` folder)
- Co-located tests: `*.test.ts`

## Does not belong here

| Kind                          | Home instead                         |
| ----------------------------- | ------------------------------------ |
| Convex subscribe loops        | `infrastructure/convex/subscribers/` |
| Convex mutations              | `infrastructure/convex/publishers/`  |
| Effect layers / daemon-layers | Replaced by `entry/deps.ts`          |
| Harness SDK implementations   | `infrastructure/local/harness/`      |

## Port co-location (turn-completion slice)

| Port                   | daemon home                |
| ---------------------- | -------------------------- |
| `ResumeStormTracker`   | `handle-turn-completed.ts` |
| `ResumeStormCheck`     | `handle-turn-completed.ts` |
| `TurnCompletedBackend` | `handle-turn-completed.ts` |

## Port co-location (direct-harness slice)

| Port                    | daemon home                      |
| ----------------------- | -------------------------------- |
| `SessionRepository`     | `open-harness-session.ts`        |
| `OutputRepository`      | `open-harness-session.ts`        |
| `OutputChunk`           | `open-harness-session.ts`        |
| `JournalFactory`        | `open-harness-session.ts`        |
| `SessionJournal`        | `open-harness-session.ts`        |
| `CapabilitiesPublisher` | `update-harness-capabilities.ts` |
