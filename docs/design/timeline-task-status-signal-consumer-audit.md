# Timeline task-status signal consumer audit

_Audited: 2026-08-21_

| Artifact                                              | Consumers                                                                       | Verdict                                                             |
| ----------------------------------------------------- | ------------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| `chatroom_timelineTaskStatusSignals` table            | Webapp and daemon                                                               | **KEEP**                                                            |
| `by_chatroom_signalKey`                               | `messageList.ts` `getLatestTaskStatusSignalKey`, webapp timeline                | **KEEP**                                                            |
| `by_targetMachineId_signalKey`                        | `messageList.ts` machine subscription, `list-tasks-for-machine-signal-range.ts` | **KEEP**                                                            |
| `targetMachineId`, `targetRole`                       | Signal write paths and machine inbox                                            | **KEEP**                                                            |
| Legacy rows missing `targetMachineId`                 | Excluded from machine index; startup snapshot bootstrap                         | **DEFER** migration/backfill                                        |
| `assignedTaskSignalSchema`, `parseAssignedTaskSignal` | Snapshot sync helpers and test fixtures                                         | **KEEP** as snapshot projection contract; not daemon subscribe APIs |

## When to remove schema artifacts

Consider removal only after PR #1471 is merged and the daemon inbox is deployed to all machines. Run a fresh `rg` consumer audit and require zero production consumers for two release cycles. The webapp timeline must migrate off any index first. Field/index removal requires a Convex migration; historical rows must either be backfilled with `targetMachineId` or explicitly accepted as bootstrap-only compatibility. Bundle this work with the next schema cleanup sprint rather than doing it ad hoc.
