# Plan 025: Agent Reliability System Design

## Summary

This plan introduces a two-model agent liveness detection system that fundamentally solves the problem of undetected agent failures. The system distinguishes between **remote agents** (daemon-managed, with heartbeat-based liveness) and **custom agents** (user-managed, with task-acknowledgement-timeout liveness). It also addresses duplicate auto-restart commands, stuck task recovery, and process death monitoring.

## Goals

1. **Detect agent failures within bounded time** — Remote agents within ~60s (heartbeat expiry), custom agents within ~5 min (task acknowledgement timeout)
2. **Automatically recover from failures** — Remote agents auto-restart via daemon; custom agents notify the user
3. **Prevent duplicate restart commands** — At most one pending restart per role per chatroom
4. **Recover stuck tasks** — Tasks in `pending` or `acknowledged` with no reachable agent are automatically reset
5. **Prove correctness** — Each invariant is verifiable and testable

## Non-Goals

1. Changes to the agent prompt system or handoff workflow
2. UI redesign for agent status display (may be a follow-up)
3. Changes to the team/role configuration system
4. Performance optimizations unrelated to reliability
5. Replacing Convex's built-in WebSocket reconnection
