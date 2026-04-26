# OpenCode SDK Runtime Agent Smoke Test

## Goal

Verify that an opencode-sdk-spawned agent receives the chatroom system prompt and does NOT throw `"Agent not found: \"chatroom-planner\""`.

## Pre-reqs

- `opencode` binary installed and on PATH
- Daemon is configured to use the `opencode-sdk` harness
- Chatroom backend reachable

## Repro Steps

1. Build and run the daemon pointing to the local CLI:

   ```bash
   pnpm --filter chatroom-cli build
   chatroom machine start --harness opencode-sdk
   ```

2. Trigger a planner spawn (e.g. send a user message in a fresh chatroom):

   ```bash
   chatroom messages send --chatroom <room-id> "Hello planner, list the recent commits"
   ```

3. Watch daemon logs for the spawn event and response.

## Pass Criteria

- Daemon logs show `agent.requestStart` followed by NO `Agent not found` error.
- Daemon logs show forwarded session events from the agent (event forwarder still works).
- The agent acts on the system prompt (responds with role-appropriate behavior).

## Fail Signature

The original regression error string:

```
Agent not found: "chatroom-planner"
```

If you see this, the fix has regressed — the client.config.update is not registering runtime agents.
