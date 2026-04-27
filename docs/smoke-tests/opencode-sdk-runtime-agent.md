# OpenCode SDK Runtime Agent Smoke Test

## Goal

Verify a fresh planner spawn against a real `opencode serve` reaches `session.idle` without any `Agent not found:` line in the daemon log, and that the planner observably acts on the chatroom role (not as a plain `build` agent).

## How agent selection works (current)

- `OpenCodeSdkAgentService.spawn()` calls `client.app.agents()` to fetch the live agent list.
- `selectAgent()` filters subagents, prefers the built-in `'build'`, falls back to the first remaining primary, throws if none.
- `composeSystemPrompt()` appends the chatroom role's system prompt to the chosen agent's `prompt` field, joined by the `# Chatroom Role & Instructions (Important)` separator, and sends it as `body.system` on `session.promptAsync`.

## Pre-reqs

- `opencode` binary installed and on PATH
- Daemon is configured to use the `opencode-sdk` harness
- Chatroom backend reachable
- Ensure your `opencode` config exposes at least one non-subagent (the `build` agent ships by default).

## Repro Steps

1. Rebuild the CLI and start the daemon:

   ```bash
   pnpm --filter chatroom-cli build
   chatroom machine start --harness opencode-sdk
   ```

2. Trigger a planner spawn (send a planner-targeted message in a fresh chatroom):

   ```bash
   chatroom messages send --chatroom <room-id> "Hello planner, list the recent commits"
   ```

3. Tail the daemon logs to observe spawn events and responses.

## Pass Criteria

ALL of the following must hold:

- No daemon log line matches the regex `Agent not found:`.
- No daemon log line matches the regex `role:[a-z]+ spawn-error\]`.
- A `session.idle` event arrives for the spawned planner session within 60 seconds of `agent.requestStart`.
- The planner's response demonstrates chatroom-role awareness (e.g. it acknowledges its planner role, references the workflow, or hands off correctly). A response that reads as a generic opencode `build` reply is a FAIL even if no errors appear.

## Fail signatures

- `Agent not found: "<name>"` — selection picked an agent the server doesn't have. Re-check `client.app.agents()` response and `selectAgent` logic.
- `role:<role> spawn-error] No usable opencode agent available` — server returned an empty (or all-subagent) list. Check the operator's `opencode` config.
- `role:<role> spawn-error] app.agents timed out after 10000ms` — server is unresponsive on `/agent`. Check serve health.
- Generic, role-agnostic reply with no `Agent not found` errors — system-prompt composition reached the model but the role context didn't take. Inspect `composeSystemPrompt` output.

## What this smoke test does NOT cover

This is a manual recipe — there is no integration test that boots a real `opencode serve` automatically. Recommended follow-up is to add one.
