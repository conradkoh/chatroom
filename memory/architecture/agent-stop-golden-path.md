---
type: decision-log
title: Agent stop golden path
description: Durable aggregate stop commands, exact-target daemon execution, projection-driven UI.
tags: [agents, daemon, convex, stop, lifecycle]
status: stable
---

# Agent stop golden path

## Decision

One durable `chatroom_agentStopCommands` aggregate represents each logical stop action. The backend snapshots exact PID targets once, the daemon executes only those assigned targets, and per-role `agentRoleView.stopState` drives the UI.

## Key invariants

- `targetKey = machineId + normalizedRole + pid` and is an immutable PID snapshot.
- User actions call one `requestAgent` or `requestChatroom` mutation; clients do not fan out stop requests.
- Scoped fanout uses a 10-second graceful-to-force-kill budget per target (`SCOPE_TARGET_STOP_TIMEOUT_MS`).
- Direct single-agent `doStop` uses 30 seconds (`STOPPING_TIMEOUT_MS`); the timeout split is intentional.
- Sidebar agent and command-run stops are independent branches coordinated with `Promise.allSettled`.
- Physical lifecycle completion, not the initial request, clears the persisted PID.

## Architecture references

- PR: https://github.com/conradkoh/chatroom/pull/1506
- Audit: [stop-command-daemon-report.md](../../docs/audit/stop-command-daemon-report.md)
