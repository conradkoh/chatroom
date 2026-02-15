# Plan 026: PRD — Heartbeat Self-Healing + Agent Status FSM

## Glossary

| Term | Definition |
|------|-----------|
| **Self-Healing** | The system's ability to automatically recover from transient disconnections without manual intervention, once normal heartbeat communication resumes. |
| **Transient Disconnect** | A temporary loss of heartbeat communication (e.g., network hiccup, Convex function redeployment, brief CPU stall) that resolves on its own. |
| **Re-join Signal** | A response from the `participants.heartbeat` mutation indicating the participant record was deleted and the CLI should call `participants.join` to re-create it. |
| **Daemon Recovery** | The process by which a daemon marked `daemonConnected: false` by cleanup is automatically restored to `daemonConnected: true` when it resumes heartbeating. |
| **Agent Status FSM** | A finite state machine that tracks the lifecycle of an agent through 6 states: `offline`, `dead`, `dead_failed_revive`, `ready`, `restarting`, `working`. |
| **Dead State** | Any FSM state where the agent has no active heartbeat: `offline`, `dead`, `dead_failed_revive`. |
| **Alive State** | Any FSM state where the agent has an active heartbeat: `ready`, `working`. `restarting` is transitional (no heartbeat yet, but recovery is in progress). |

## User Stories

### Machine Operator

1. As an operator, when my daemon experiences a brief network hiccup, I want the system to automatically recover the daemon's "connected" status so that the frontend doesn't show "No machines online" incorrectly.
2. As an operator, I want the frontend machine status to accurately reflect reality — if the daemon is running and heartbeating, it should show as connected.
3. As an operator, when an agent crashes and the daemon is restarting it, I want to see "RESTARTING" in the UI so I know recovery is in progress.
4. As an operator, when all restart attempts fail, I want to see "DEAD (UNRECOVERABLE)" so I know manual intervention is needed.

### Agent User

5. As a user running agents via CLI, when a transient issue causes my participant record to be cleaned up, I want the system to automatically re-join my agent so that heartbeat warnings stop and the agent remains reachable.
6. As a user, I don't want to have to manually restart agents after brief connectivity issues.
7. As a user, I want the agent status in the UI to accurately reflect what the agent is doing — waiting for tasks, working on a task, being restarted, or permanently failed.

### System Reliability

8. As the system, after any transient disconnection resolves, I should return to a fully healthy state within one heartbeat cycle (30 seconds), without requiring manual intervention.
9. As the system, I should not enter a permanent degraded state (endless "participant not found" warnings) due to a one-time cleanup event.
10. As the system, the agent status displayed in the UI should always match the actual state of the agent process, with no discrepancies between "WORKING" status and an agent that has actually crashed.
