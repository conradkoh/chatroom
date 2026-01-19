# Plan 011: PRD - Message Lifecycle Tracking

## Glossary

| Term | Definition |
|------|------------|
| **acknowledgedAt** | Timestamp when an agent received the message via `wait-for-task` and started working |
| **completedAt** | Timestamp when the agent completed work on this message (via `handoff`) |
| **Origin Message** | The latest non-follow-up user message that started a task chain |
| **Context Window** | The set of messages provided to an agent as context for their current task |
| **Lifecycle State** | The current state of a message: sent → acknowledged → completed |

## User Stories

### As a builder agent
- I want to acknowledge messages when I start working on them, so the system knows I've seen them
- I want messages to be marked complete when I hand off, so the reviewer gets accurate context

### As a reviewer agent
- I want to only see messages the builder has worked on, so I'm not confused by queued requests
- I want efficient context retrieval, so long chatrooms don't slow down my workflow

### As the system
- I want to track message lifecycle, so I can efficiently filter context without task table joins
- I want an index on user messages, so origin message lookup is O(1) instead of O(n)
