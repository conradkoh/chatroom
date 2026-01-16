# 002 - Message-Task Integration

## Summary

Integrate the message and task systems so that every user message automatically creates a corresponding task. This provides:
1. Better tracking of message processing status
2. Automatic queue management when agents are busy
3. Unified view of work items in the UI

## Goals

1. **Unified Workflow**: Every user message becomes a trackable task
2. **Automatic Queue Management**: New messages create queued tasks if an agent is already working
3. **Status Visibility**: UI shows task status (pending/in_progress/queued/completed) for each message
4. **Reliable Polling**: `wait-for-message` finds pending tasks instead of using timestamp markers

## Non-Goals

- Modifying backlog functionality (manually created tasks remain separate)
- Changing the task status state machine (pending → in_progress → completed remains the same)
- Altering handoff/routing logic between agents
