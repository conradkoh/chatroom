# Chatroom Workspace Configuration Service

Daemon-local source of truth for workspace configuration reads — currently the
agent runtime config (`agentHarness`, `model`, `workingDir`) per
`(chatroomId, role)`.

The service is fed exclusively by durable Convex inboxes (today:
`chatroomWorkspaceAgentConfigInbox`, served via `api.daemon.agentConfigInbox`),
using the same pending → processed lifecycle as the task inbox: watch + boot
replay, ack only after the entry is applied locally. Convex launch requests
remain authoritative records; this service never reads them directly.

Future workspace settings arrive as additional durable inboxes consumed here —
never as task payloads or direct cross-DB subscriptions.

Consumers: task delivery (`decideNextDelivery` resolves runtime config here at
decision time). The agent process service must not depend on this service — it
executes the config it is given at spawn time.
