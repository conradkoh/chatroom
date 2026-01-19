# Plan 010: Agent Prompt Reliability - PRD

## Glossary

| Term | Definition |
|------|------------|
| **Entry Point** | The role that receives user messages directly (typically `builder`) |
| **Context Window** | The set of messages from the origin message to now, provided to agents |
| **Origin Message** | The first non-follow-up user message that started a task chain |
| **Classification** | The type of user request: `question`, `new_feature`, or `follow_up` |
| **Role Prompt** | The role-specific instructions appended to each message |
| **Init Prompt** | The initial system prompt given when an agent joins a chatroom |

## User Stories

### Prompts Reliability

1. **As the builder agent**, I want clear instructions on what to do when `wait-for-task` terminates unexpectedly, so that I always resume listening for messages.

2. **As any agent**, I want the prompt to clearly state what to do after each handoff, so that I never forget to run `wait-for-task`.

3. **As the system**, I want prompts to be consistent across frontend (init) and backend (role) generators, so that agents don't receive conflicting instructions.

### Reviewer Role

4. **As the reviewer agent**, I want to clearly understand that I should NOT run `task-started`, so that I don't accidentally reclassify tasks.

5. **As the reviewer agent**, I want to receive only messages that are targeted at me, so that I don't process builder-to-user handoffs incorrectly.

### Message Routing

6. **As the reviewer agent**, I want to receive the correct context window, so that I understand the full task history.

7. **As the system**, I want the `getLatestForRole` query to correctly filter messages for non-entry-point roles, so that the reviewer doesn't receive user messages.
