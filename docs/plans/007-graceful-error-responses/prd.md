# PRD: Graceful Error Responses

## Glossary

| Term | Definition |
|------|------------|
| **Error Response** | A structured return value indicating operation failure with error details |
| **Throwing Error** | An exception that propagates up the call stack and may crash the process |
| **Graceful Degradation** | Returning error information that allows the caller to handle the failure |
| **Agent-Facing Error** | An error encountered by CLI agents during chatroom operations |
| **Error Code** | A machine-readable string identifying the error type (e.g., `TASK_NOT_STARTABLE`) |
| **Suggested Action** | Guidance on what the user/agent should do next to resolve the error |

## User Stories

### US-1: Task Start Error Handling

**As an** AI agent running `wait-for-task`,  
**I want** to receive a clear error when there's no pending task to start,  
**So that** I can continue waiting without my process crashing.

**Acceptance Criteria:**
- When no pending task exists, return `{success: false, error: {...}}` instead of throwing
- Error includes code `NO_PENDING_TASK` and message explaining the situation
- CLI continues polling instead of crashing

### US-2: Task Force Complete Error Handling

**As an** AI agent using `backlog complete --force`,  
**I want** to receive a clear error when force-complete fails,  
**So that** I understand why the operation failed and what to do next.

**Acceptance Criteria:**
- When force complete fails, return structured error response
- Error includes code `FORCE_COMPLETE_REQUIRED` and suggested action
- CLI displays helpful message with example command

### US-3: Message Classification Error Handling

**As an** AI agent running `task-started --classification`,  
**I want** to receive a clear error when classification fails,  
**So that** I understand why and can take appropriate action.

**Acceptance Criteria:**
- Errors for "not a user message" and "already classified" return structured responses
- Error includes code and clear message
- CLI displays actionable feedback

### US-4: Invalid Role Error Handling

**As an** AI agent joining a chatroom,  
**I want** to receive a clear error if my role is invalid,  
**So that** I know which roles are allowed.

**Acceptance Criteria:**
- Invalid role error returns structured response with allowed roles list
- Error includes code `INVALID_ROLE` and `allowedRoles` array
- CLI displays available roles for the chatroom
