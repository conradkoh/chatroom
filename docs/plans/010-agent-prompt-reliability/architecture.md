# Plan 010: Agent Prompt Reliability - Architecture

## Changes Overview

This plan involves targeted fixes across the prompt generation system and message routing logic.

## Modified Components

### 1. Backend Role Prompt Generator
**File:** `services/backend/convex/prompts/generator.ts`

**Changes:**
- Strengthen `wait-for-task` instructions for all roles
- Add explicit "after handoff" reminders
- Ensure reviewer workflow explicitly states NOT to run `task-started`

### 2. Frontend Init Prompts
**Files:**
- `apps/webapp/src/modules/chatroom/prompts/init/base.ts`
- `apps/webapp/src/modules/chatroom/prompts/init/roles.ts`
- `apps/webapp/src/modules/chatroom/prompts/init/wait-for-task.ts`

**Changes:**
- Verify `wait-for-task` section includes unexpected termination handling
- Ensure reviewer guidance is clear about not running `task-started`
- Add consistency checks between frontend and backend prompts

### 3. Message Routing (if needed)
**File:** `services/backend/convex/messages.ts`

**Potential Changes:**
- Review `getLatestForRole` query logic for edge cases
- Review `getContextWindow` query for correct origin detection
- Ensure handoff messages are correctly targeted

## Consistency Audit

The following areas need cross-referencing for consistency:

| Topic | Frontend Location | Backend Location |
|-------|-------------------|------------------|
| `wait-for-task` lifecycle | `init/wait-for-task.ts` | `generator.ts: getCommandsSection` |
| Reviewer workflow | `init/roles.ts: getReviewerGuidance` | `generator.ts: getReviewerWorkflow` |
| Handoff rules | `init/base.ts` | `generator.ts: getHandoffSection` |

## Data Flow

```
User Message
    │
    ▼
Builder (entry point)
    │
    ├─── task-started (classify)
    │
    ▼
Builder does work
    │
    ├─── handoff --next-role=reviewer
    │
    ▼
Reviewer receives handoff message  ◄── getLatestForRole filters correctly
    │
    ├─── Does NOT run task-started
    │
    ▼
Reviewer reviews work
    │
    ├─── handoff --next-role=user (approved) OR --next-role=builder (changes)
    │
    ▼
...
```

## No New Contracts

This plan modifies existing components only. No new entities, interfaces, or types are required.
