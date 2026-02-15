# Plan 026: PRD — Heartbeat Self-Healing

## Glossary

| Term | Definition |
|------|-----------|
| **Self-Healing** | The system's ability to automatically recover from transient disconnections without manual intervention, once normal heartbeat communication resumes. |
| **Transient Disconnect** | A temporary loss of heartbeat communication (e.g., network hiccup, Convex function redeployment, brief CPU stall) that resolves on its own. |
| **Re-join Signal** | A response from the `participants.heartbeat` mutation indicating the participant record was deleted and the CLI should call `participants.join` to re-create it. |
| **Daemon Recovery** | The process by which a daemon marked `daemonConnected: false` by cleanup is automatically restored to `daemonConnected: true` when it resumes heartbeating. |

## User Stories

### Machine Operator

1. As an operator, when my daemon experiences a brief network hiccup, I want the system to automatically recover the daemon's "connected" status so that the frontend doesn't show "No machines online" incorrectly.
2. As an operator, I want the frontend machine status to accurately reflect reality — if the daemon is running and heartbeating, it should show as connected.

### Agent User

3. As a user running agents via CLI, when a transient issue causes my participant record to be cleaned up, I want the system to automatically re-join my agent so that heartbeat warnings stop and the agent remains reachable.
4. As a user, I don't want to have to manually restart agents after brief connectivity issues.

### System Reliability

5. As the system, after any transient disconnection resolves, I should return to a fully healthy state within one heartbeat cycle (30 seconds), without requiring manual intervention.
6. As the system, I should not enter a permanent degraded state (endless "participant not found" warnings) due to a one-time cleanup event.
