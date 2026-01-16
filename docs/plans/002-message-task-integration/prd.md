# PRD: Message-Task Integration

## Glossary

| Term | Definition |
|------|------------|
| **Message** | A communication unit in `chatroom_messages` (user or agent) |
| **Task** | A work item in `chatroom_tasks` with status lifecycle |
| **Pending Task** | Task ready for agent to pick up |
| **In Progress Task** | Task currently being worked on by an agent |
| **Queued Task** | Task waiting in line (created when another task is in progress) |
| **Backlog Task** | Manually created future work item |
| **Message-Task Link** | Foreign key from message to its associated task |

## User Stories

### US-1: Automatic Task Creation
**As a** user sending a message  
**I want** a task to be automatically created  
**So that** the agent can track and process my request

**Acceptance Criteria:**
- When user sends a message, a task is created automatically
- Task status is "pending" if no other task is active
- Task status is "queued" if another task is in progress
- Message has reference to the created task

### US-2: Task Status in UI
**As a** user viewing the message feed  
**I want** to see the processing status of my messages  
**So that** I know if my request is pending, being worked on, or complete

**Acceptance Criteria:**
- Each user message displays its associated task status
- Status indicators: 🟢 pending, 🔵 in_progress, 🟡 queued, ✅ completed

### US-3: Reliable Message Polling
**As an** agent running wait-for-message  
**I want** to receive all pending tasks (not just new messages)  
**So that** I don't miss messages sent before I started listening

**Acceptance Criteria:**
- wait-for-message finds the oldest pending task
- No messages are skipped due to startup timing
- Agent receives task content along with message

### US-4: Queue Processing
**As an** agent completing a task  
**I want** the next queued task to become pending automatically  
**So that** the message queue processes in order

**Acceptance Criteria:**
- When task-complete runs, current task moves to completed
- Oldest queued task promotes to pending
- Agent can immediately pick up next pending task
