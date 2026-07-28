# Task Lifecycle Refactor — Test Surface Area

## Automated suites

| Area                 | Command                                                                                                                           |
| -------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| Slice 1 CLI          | `pnpm --filter chatroom-cli test execution-kind native-spawn-presence`                                                            |
| Receipt domain       | `pnpm --filter @workspace/backend test record-task-delivery task-delivery-receipt`                                                |
| Token activity rules | `pnpm --filter @workspace/backend test start-task-from-token-activity`                                                            |
| Integration matrix   | `pnpm --filter @workspace/backend test task-transition-matrix task-delivery-receipt enhancer-spawn resume-session-token-activity` |
| Harness emitter      | `pnpm --filter chatroom-cli test harness-activity-emitter session-event-forwarder`                                                |

## Manual QA (production-like)

| #   | Scenario                    | Steps                                                                  | Expected                                                           |
| --- | --------------------------- | ---------------------------------------------------------------------- | ------------------------------------------------------------------ |
| 1   | Native inject → in_progress | Duo + opencode-sdk builder; user message creates task; daemon delivers | Receipt in DB; task in_progress on first output/busy; no errors    |
| 2   | busy before thinking        | Watch daemon logs during inject                                        | updateTokenActivity on busy event                                  |
| 3   | Enhancer check-in           | Planner → enhancer handoff                                             | Task in_progress on claim; no enhancer participant; no join errors |
| 4   | get-next-task               | Non-native harness blocking get-next-task                              | cli_get_next_task receipt; acknowledged → in_progress on activity  |
| 5   | Legacy no receipt           | Pre-migration or test chatroom without receipts                        | Acknowledged + native:task-injected + token activity still works   |
| 6   | Pending resume after exit   | Agent exit with queued pending                                         | recovered-pending rule still fires                                 |
| 7   | Slice 1 regression          | Open enhancer task in TaskDetailModal                                  | Structured sections (unrelated but verify no daemon regression)    |

## Receipt lifecycle

- **One open receipt** per `(chatroomId, role, taskId)` — `recordTaskDelivery` upserts
- **startedAt by kind:**
  - `native_inject`: set `deliveredAt` on record; `startedAt` on first token activity
  - `enhancer_claim`: set `deliveredAt` AND `startedAt` at claim time
  - `cli_get_next_task`: set `deliveredAt` on claimTask; `startedAt` on first token activity
- **Closed receipt** (`startedAt` set): receipt rule no-op; legacy rules may still apply

## Token Activity Rules (ordered by priority)

1. `receipt-not-started` — if open receipt exists, start from receipt
2. `acknowledged-native` — existing acknowledged task + native injection path
3. `recovered-pending` — existing pending task recovery paths
