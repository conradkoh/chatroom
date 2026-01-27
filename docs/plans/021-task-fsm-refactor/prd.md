# PRD: Task Finite State Machine Refactor

## Glossary

| Term | Definition |
|------|------------|
| **Finite State Machine (FSM)** | A computational model with a finite number of states, where transitions between states are strictly defined and enforced |
| **Task Status** | The current lifecycle stage of a task (e.g., pending, acknowledged, in_progress) - the single source of truth for workflow state |
| **Task Origin** | Where a task was created from (`chat` or `backlog`) - determines which workflow applies |
| **Acknowledged** | State when an agent has claimed a task via `wait-for-task` but hasn't yet called `task-started` |
| **Backlog Acknowledged** | State when a user has attached a backlog task to a message, making it visible to agents |
| **Parent Task** | The main task that backlog tasks are attached to - when this completes, attached backlog tasks transition to `pending_user_review` |
| **State Transition** | Moving from one task status to another according to FSM rules |
| **Transition Validation** | Checking if a requested state transition is allowed by the FSM |
| **Field Cleanup** | Automatically clearing stale metadata fields (like `startedAt`) when transitioning to a new state |
| **Structured Error** | An error with a machine-readable code and variables that AI agents can parse and act on |

## User Stories

### As an AI Agent

**Story 1: Receiving Tasks Without Duplicates**
```
As an AI agent,
I want to receive each task exactly once when I run wait-for-task,
So that I don't waste time processing the same message multiple times when I reconnect.
```

**Story 2: Clear Acknowledgment Flow**
```
As an AI agent,
I want separate steps for claiming a task and starting work,
So that the system knows I've received the task even if I need time to analyze it before starting.
```

**Story 3: Understanding Invalid Transitions**
```
As an AI agent,
I want clear error messages when I try an invalid action,
So that I know exactly what commands I should run to fix the issue.
```

**Story 4: Backlog Task Visibility**
```
As an AI agent,
I want to see which backlog tasks are attached to my current task,
So that I can address related issues while working on the main request.
```

### As a User

**Story 5: Reliable Task Transitions**
```
As a user,
I want backlog tasks to automatically move to review when the main task completes,
So that I can confirm all related work was done without manually checking each item.
```

**Story 6: Consistent State Display**
```
As a user,
I want the task status in the UI to always match reality,
So that I know the true state of work without confusion.
```

**Story 7: Agent Recovery**
```
As a user,
I want agents to seamlessly recover when they restart or disconnect,
So that my workflow isn't disrupted by technical issues.
```

### As a System Developer

**Story 8: Enforced State Machine**
```
As a system developer,
I want all task transitions to go through a single FSM helper,
So that I can't accidentally create invalid states by directly patching the database.
```

**Story 9: Auditable Transitions**
```
As a system developer,
I want all state transitions logged with context,
So that I can debug issues by tracing the task lifecycle.
```

**Story 10: Automatic Field Management**
```
As a system developer,
I want the FSM to automatically manage metadata fields like timestamps,
So that I don't have to remember to clear stale fields on every transition.
```
