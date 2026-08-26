# Timeline task-status signal consumer audit

_Audited: 2026-08-21. Physical schema split completed 2026-08-21._

| Artifact                                              | Consumers                                               | Verdict                                  |
| ----------------------------------------------------- | ------------------------------------------------------- | ---------------------------------------- |
| `chatroom_timelineTaskStatusSignals` table            | Webapp timeline cursor (`getLatestTaskStatusSignalKey`) | **KEEP** — chatroom-scoped only          |
| `by_chatroom_signalKey`                               | `messageList.ts` `getLatestTaskStatusSignalKey`         | **KEEP**                                 |
| `chatroom_machineTaskStatusSignals` table             | Daemon inbox subscribe + range hydration                | **KEEP** — machine-scoped                |
| `by_machineId_signalKey`                              | `messageList.ts` subscribe and range hydration          | **KEEP**                                 |
| `targetMachineId`, `targetRole` on timeline table     | None                                                    | **REMOVED**                              |
| `by_targetMachineId_signalKey` on timeline table      | None                                                    | **REMOVED**                              |
| Legacy timeline rows                                  | Webapp timeline cursor only                             | **KEEP** — historical chatroom events    |
| `assignedTaskSignalSchema`, `parseAssignedTaskSignal` | Snapshot sync helpers and fixtures                      | **KEEP** as snapshot projection contract |

## Schema split rationale

The timeline table is chatroom-scoped for webapp cursor seeding. The machine table has required `machineId` and `targetRole` for daemon subscription and hydration. `migrateMachineTaskStatusSignals` backfills routed history before `stripTimelineMachineSignalFields` removes legacy routing fields.
