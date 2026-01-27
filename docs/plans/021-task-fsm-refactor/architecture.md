# Architecture: Task Finite State Machine Refactor

## Changes Overview

This plan introduces a strict Finite State Machine (FSM) for task lifecycle management:

1. **Add new task statuses**: `acknowledged`, `backlog_acknowledged`
2. **Add task relationship fields**: `attachedTaskIds`, `parentTaskIds`
3. **Create FSM enforcement layer**: `lib/taskStateMachine.ts`
4. **Refactor all mutations**: Use `transitionTask()` instead of direct `ctx.db.patch()`
5. **Remove timestamp-based logic**: Status field becomes the only workflow decision point

## New Components

### FSM Enforcement Layer (`lib/taskStateMachine.ts`)

Single module responsible for all task state transitions.

**Responsibilities:**
- Validate transition is allowed
- Clear stale metadata fields
- Set required fields
- Log transitions for auditing
- Throw structured errors with AI-readable guidance

**Key Function:**
```typescript
transitionTask(ctx, taskId, newStatus, overrides?)
```

## Modified Components

### Schema (`schema.ts`)

**Task Status Enum** - Add new states:
- `acknowledged` - Agent claimed task, not yet started
- `backlog_acknowledged` - User attached backlog task to message

**Task Table** - Add relationship tracking:
- `attachedTaskIds` - Backlog tasks attached to this task
- `parentTaskIds` - Tasks this backlog item is attached to (can be multiple)

### Task Mutations (`tasks.ts`)

**All mutations updated to use FSM:**
- `startTask` → calls `transitionTask()`
- `completeTask` → calls `transitionTask()`
- `cancelTask` → calls `transitionTask()`
- `resetStuckTask` → calls `transitionTask()`
- `moveToQueue` → calls `transitionTask()`
- `sendBackForRework` → calls `transitionTask()`
- `markBacklogComplete` → calls `transitionTask()`
- `closeBacklogTask` → calls `transitionTask()`
- `reopenBacklogTask` → calls `transitionTask()`
- `promoteNextTask` → calls `transitionTask()`

### Message Mutations (`messages.ts`)

**Handoff handler updated:**
- Attach backlog tasks transition when parent acknowledged
- Use `transitionTask()` for all status changes

**Task acknowledgment:**
- Split `startTask` into two steps: `claimTask` + `startTask`
- `claimTask` → transitions to `acknowledged`
- `startTask` → transitions to `in_progress`

### Query (`tasks.ts`)

**getPendingTasksForRole** - Simplified logic:
- Only check `status === 'pending'`
- Remove `startedAt` filtering
- FSM guarantees no invalid states exist

## New Contracts

### FSM Configuration

```typescript
/**
 * Task status - single source of truth for workflow state
 */
type TaskStatus =
  // User message flow
  | 'pending'              // Created, waiting for agent
  | 'acknowledged'         // Agent claimed via wait-for-task
  | 'in_progress'          // Agent started work via task-started
  | 'completed'            // Work finished

  // Backlog flow
  | 'backlog'              // In backlog tab, not sent yet
  | 'backlog_acknowledged' // Attached to message, visible to agent
  | 'pending_user_review'  // Agent done, awaiting user confirmation

  // Common
  | 'queued'               // Waiting in queue (future: messages only)
  | 'closed';              // Cancelled

/**
 * FSM transition definition
 */
interface TransitionRule {
  from: TaskStatus;
  to: TaskStatus;
  trigger: string;                     // Mutation name
  requiredFields?: Array<keyof Task>;  // Must be provided
  setFields?: Partial<Task>;           // Auto-set (use 'NOW' for timestamps)
  clearFields?: Array<keyof Task>;     // Auto-clear (set to undefined)
  validate?: (task: Task) => boolean;  // Custom validation
}

/**
 * All valid state transitions
 */
const TRANSITIONS: TransitionRule[] = [
  // User message flow: pending → acknowledged → in_progress → completed
  {
    from: 'pending',
    to: 'acknowledged',
    trigger: 'claimTask',
    requiredFields: ['assignedTo'],
    setFields: { acknowledgedAt: 'NOW', assignedTo: 'PROVIDED' },
    clearFields: []
  },
  {
    from: 'acknowledged',
    to: 'in_progress',
    trigger: 'startTask',
    setFields: { startedAt: 'NOW' },
    clearFields: []
  },
  {
    from: 'in_progress',
    to: 'completed',
    trigger: 'completeTask',
    setFields: { completedAt: 'NOW' },
    clearFields: []
  },

  // Backlog flow: backlog → backlog_acknowledged → pending_user_review → completed
  {
    from: 'backlog',
    to: 'backlog_acknowledged',
    trigger: 'attachToMessage',
    requiredFields: ['parentTaskIds'],
    setFields: { parentTaskIds: 'PROVIDED' },
    clearFields: []
  },
  {
    from: 'backlog_acknowledged',
    to: 'pending_user_review',
    trigger: 'parentTaskAcknowledged',
    setFields: {},
    clearFields: []
  },
  {
    from: 'pending_user_review',
    to: 'completed',
    trigger: 'markBacklogComplete',
    setFields: { completedAt: 'NOW' },
    clearFields: []
  },

  // Rework: pending_user_review → pending
  {
    from: 'pending_user_review',
    to: 'pending',
    trigger: 'sendBackForRework',
    setFields: {},
    clearFields: ['acknowledgedAt', 'startedAt', 'assignedTo', 'completedAt', 'parentTaskIds']
  },

  // Queue promotion: queued → pending
  {
    from: 'queued',
    to: 'pending',
    trigger: 'promoteNextTask',
    setFields: {},
    clearFields: ['startedAt', 'assignedTo'] // Defensive cleanup
  },

  // Cancellation: any active state → closed
  {
    from: 'pending',
    to: 'closed',
    trigger: 'cancelTask',
    setFields: {},
    clearFields: []
  },
  {
    from: 'acknowledged',
    to: 'closed',
    trigger: 'cancelTask',
    setFields: {},
    clearFields: []
  },
  {
    from: 'queued',
    to: 'closed',
    trigger: 'cancelTask',
    setFields: {},
    clearFields: []
  },
  {
    from: 'backlog',
    to: 'closed',
    trigger: 'cancelTask',
    setFields: {},
    clearFields: []
  },
  {
    from: 'backlog_acknowledged',
    to: 'closed',
    trigger: 'cancelTask',
    setFields: {},
    clearFields: []
  },
  {
    from: 'pending_user_review',
    to: 'closed',
    trigger: 'cancelTask',
    setFields: {},
    clearFields: []
  },

  // Recovery: in_progress → pending
  {
    from: 'in_progress',
    to: 'pending',
    trigger: 'resetStuckTask',
    setFields: {},
    clearFields: ['startedAt', 'assignedTo']
  },

  // Reopening: completed/closed → pending_user_review
  {
    from: 'completed',
    to: 'pending_user_review',
    trigger: 'reopenBacklogTask',
    validate: (task) => task.origin === 'backlog',
    setFields: {},
    clearFields: ['completedAt']
  },
  {
    from: 'closed',
    to: 'pending_user_review',
    trigger: 'reopenBacklogTask',
    validate: (task) => task.origin === 'backlog',
    setFields: {},
    clearFields: ['completedAt']
  },

  // Backlog to queue: backlog → pending/queued
  {
    from: 'backlog',
    to: 'pending',
    trigger: 'moveToQueue',
    setFields: {},
    clearFields: ['startedAt', 'assignedTo', 'completedAt']
  },
  {
    from: 'backlog',
    to: 'queued',
    trigger: 'moveToQueue',
    setFields: {},
    clearFields: ['startedAt', 'assignedTo', 'completedAt']
  }
];
```

### Error Codes

```typescript
/**
 * Structured error for invalid transitions
 */
interface TaskTransitionError {
  code: 'TASK_INVALID_TRANSITION' | 'TASK_VALIDATION_FAILED' | 'TASK_MISSING_REQUIRED_FIELD';
  message: string;
  variables: {
    taskId: string;
    currentStatus?: TaskStatus;
    attemptedStatus?: TaskStatus;
    trigger?: string;
    validTransitions?: Array<{
      to: TaskStatus;
      trigger: string;
      requiredFields?: string[];
    }>;
    missingField?: string;
    validationReason?: string;
  };
}

/**
 * Error thrown when transition is invalid
 */
class InvalidTransitionError extends Error {
  constructor(public details: TaskTransitionError) {
    super(details.message);
    this.name = 'InvalidTransitionError';
  }
}
```

### FSM Helper

```typescript
/**
 * Transition a task to a new status with FSM enforcement
 * 
 * @param ctx - Mutation context
 * @param taskId - Task to transition
 * @param newStatus - Desired status
 * @param overrides - Additional fields to set (beyond FSM defaults)
 * @throws InvalidTransitionError if transition is not allowed
 */
async function transitionTask(
  ctx: MutationCtx,
  taskId: Id<'chatroom_tasks'>,
  newStatus: TaskStatus,
  overrides?: Partial<Task>
): Promise<void>;

/**
 * Get all valid transitions from a given status
 * Used for error messages and UI guidance
 */
function getValidTransitionsFrom(status: TaskStatus): TransitionRule[];

/**
 * Check if a transition is valid without executing it
 */
function canTransition(
  task: Task,
  newStatus: TaskStatus
): boolean;
```

## Modified Contracts

### Task Schema

```typescript
interface Task {
  // Existing fields
  _id: Id<'chatroom_tasks'>;
  chatroomId: Id<'chatroom_rooms'>;
  createdBy: string;
  content: string;
  origin?: 'backlog' | 'chat';
  
  // MODIFIED: Extended status enum
  status:
    | 'pending'
    | 'acknowledged'         // NEW
    | 'in_progress'
    | 'completed'
    | 'backlog'
    | 'backlog_acknowledged' // NEW
    | 'pending_user_review'
    | 'queued'
    | 'closed';
  
  assignedTo?: string;
  sourceMessageId?: Id<'chatroom_messages'>;
  
  // Timestamps (metadata only, never used for workflow logic)
  createdAt: number;
  updatedAt: number;
  startedAt?: number;
  acknowledgedAt?: number; // NEW
  completedAt?: number;
  
  queuePosition: number;
  
  // NEW: Backlog attachment tracking
  attachedTaskIds?: Id<'chatroom_tasks'>[];  // Backlog tasks attached to this task
  parentTaskIds?: Id<'chatroom_tasks'>[];    // Tasks this backlog item is attached to
  
  // Backlog scoring
  complexity?: 'low' | 'medium' | 'high';
  value?: 'low' | 'medium' | 'high';
  priority?: number;
}
```

## Data Flow Changes

### Before: Timestamp-Based Filtering

```
Agent calls wait-for-task
  ↓
getPendingTasksForRole filters:
  - status === 'pending'
  - startedAt === undefined  ❌ Workflow logic on timestamp!
  ↓
Task delivered to agent
```

**Problem**: If task has `status='pending'` but `startedAt` is set (edge case), agent never sees it.

### After: Status-Only Logic

```
Agent calls wait-for-task
  ↓
getPendingTasksForRole filters:
  - status === 'pending'  ✅ Only status checked!
  ↓
Task delivered to agent
  ↓
Agent claims task: pending → acknowledged
  ↓
FSM clears stale fields automatically
```

**Benefit**: FSM guarantees no invalid states exist. If `status='pending'`, it's truly pending.

### Backlog Attachment Flow

**Before**: Messages track attachedTaskIds, tasks don't know they're attached

**After**: Bidirectional tracking

```
User attaches backlog task B to message M (which creates task A)
  ↓
Task A.attachedTaskIds = [B]
Task B.parentTaskIds = [A]
Task B transitions: backlog → backlog_acknowledged
  ↓
Agent acknowledges task A
  ↓
All tasks in A.attachedTaskIds transition: backlog_acknowledged → pending_user_review
```

## Integration Changes

### CLI Commands

**wait-for-task**:
- Now calls new `claimTask` mutation
- Task transitions: `pending` → `acknowledged`
- Returns task to agent immediately

**task-started**:
- Calls existing `startTask` mutation
- Task transitions: `acknowledged` → `in_progress`
- Validates task is in `acknowledged` state first

### Error Handling

All mutations that modify task status will:
1. Catch `InvalidTransitionError`
2. Extract `error.details.variables`
3. Return structured error to CLI
4. CLI formats error for AI agent consumption

Example error response:
```json
{
  "success": false,
  "error": {
    "code": "TASK_INVALID_TRANSITION",
    "message": "Cannot transition task from acknowledged to completed",
    "variables": {
      "taskId": "k12345",
      "currentStatus": "acknowledged",
      "attemptedStatus": "completed",
      "trigger": "completeTask",
      "validTransitions": [
        {
          "to": "in_progress",
          "trigger": "startTask",
          "requiredFields": []
        },
        {
          "to": "closed",
          "trigger": "cancelTask",
          "requiredFields": []
        }
      ]
    },
    "aiGuidance": "Task must be started before completion. Run: chatroom task-started <id> --role=<role>"
  }
}
```

## Testing Strategy

### Unit Tests (FSM Module)

Test cases for `lib/taskStateMachine.ts`:
- Valid transitions succeed
- Invalid transitions throw structured errors
- Field cleanup works correctly
- Required fields validation
- Custom validation rules

### Integration Tests (Mutations)

Test cases for each mutation:
- Happy path uses FSM correctly
- Invalid states return proper errors
- Concurrent transitions handle races
- Backlog attachment propagation

### End-to-End Tests (CLI)

Test scenarios:
- Agent reconnect doesn't duplicate delivery
- Backlog tasks transition when parent acknowledged
- Invalid commands return actionable errors
- Agent workflow: pending → acknowledged → in_progress → completed
