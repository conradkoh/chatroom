# PRD: Task Workflow Refactor

## Glossary

| Term | Definition |
|------|------------|
| **Task Origin** | Where a task was created - either `'backlog'` (from backlog tab) or `'chat'` (from chat message) |
| **Task Status** | Current lifecycle stage of a task (`backlog`, `queued`, `pending`, `in_progress`, `pending_user_review`, `completed`, `closed`) |
| **Workflow** | The valid status transitions for a task, determined by its origin |
| **Pending User Review** | Backlog-only status where agent work is done but user must confirm completion |
| **Closed** | Backlog-only terminal status for tasks user decided not to complete |

## User Stories

### US-1: Clear Task Origin Tracking
**As a** developer working with tasks  
**I want** every task to have an explicit `origin` field  
**So that** I can determine the appropriate workflow without checking multiple fields

### US-2: Backlog Task Review Flow
**As a** user with a backlog task  
**I want** the task to go to "pending user review" after the agent completes work  
**So that** I can verify the work before marking it complete

### US-3: Chat Task Direct Completion
**As a** user with a chat-origin task  
**I want** the task to complete directly when the agent finishes  
**So that** I don't have to manually confirm routine chat tasks

### US-4: Send Back for Rework
**As a** user reviewing a backlog task  
**I want** to send the task back for additional work if needed  
**So that** the agent can address issues before I mark it complete

### US-5: Backward Compatible Migration
**As a** system administrator  
**I want** existing tasks to continue working during migration  
**So that** users don't experience disruption

## Acceptance Criteria

1. All new tasks have `origin` field set
2. Backlog tasks transition to `pending_user_review` on agent handoff to user
3. Chat tasks transition to `completed` on agent handoff to user
4. Users can mark backlog tasks as complete from `pending_user_review`
5. Users can close backlog tasks from `pending_user_review`
6. Users can send tasks back for rework from `pending_user_review`
7. Migration script sets `origin` on existing tasks
8. Legacy `backlog` field checks maintained for backward compatibility
