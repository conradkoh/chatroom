# Plan 025: PRD — Agent Reliability

## Glossary

| Term | Definition |
|------|-----------|
| **Remote Agent** | An agent managed by a daemon process. The daemon can spawn, stop, and restart the agent. Uses `wait-for-task` in a loop. Liveness is proven by heartbeat. |
| **Custom Agent** | An agent managed by a user (e.g., running in Cursor IDE). The system cannot auto-restart it. Uses `wait-for-task` as a one-shot blocking call. Liveness is inferred from task acknowledgement. |
| **Heartbeat** | A periodic signal sent by the `wait-for-task` CLI process to the backend, refreshing the participant's `readyUntil` timestamp. Not sent by the agent itself — it's infrastructure-level. |
| **Reachability** | Whether an agent can receive and respond to tasks within a bounded time. Different from liveness (an agent can be alive but not reachable). |
| **Ghost Participant** | A participant record in the backend for an agent that is no longer connected. Caused by process death without cleanup. |
| **Task Acknowledgement Timeout** | The maximum time a task can remain in `pending` without being claimed before the system considers the target agent unreachable. |
| **Auto-Restart** | The backend's ability to send `stop-agent` + `start-agent` commands to the daemon to restart a remote agent. Not available for custom agents. |
| **Restart Deduplication** | Ensuring at most one pending `start-agent` command exists per role per chatroom, preventing process churn from concurrent restarts. |

## User Stories

### Remote Agent Operator

1. As an operator, I want the system to automatically detect when a remote agent has crashed so that tasks are not stuck waiting for a dead agent.
2. As an operator, I want the system to automatically restart a crashed remote agent so that I don't need to manually intervene.
3. As an operator, I want to see accurate agent status in the UI so that I know which agents are actually running vs. appearing to run.

### Custom Agent User

4. As a user running a custom agent (e.g., in Cursor), I want the system to notify me when my agent appears unresponsive so that I can re-run `wait-for-task`.
5. As a user, I want tasks to not get permanently stuck if my agent disconnects, so that the system can recover gracefully.

### System Reliability

6. As the system, when multiple messages target an offline agent simultaneously, I should only trigger one restart (not multiple), so that there is no process churn.
7. As the system, when a task is stuck in `acknowledged` because the claiming agent died, I should reset it to `pending` and attempt recovery, so that tasks are not permanently orphaned.
8. As the system, when a daemon-managed agent process exits unexpectedly, I should detect this immediately and clean up the stale PID, so that the UI reflects reality.
