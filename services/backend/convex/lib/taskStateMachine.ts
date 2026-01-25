/**
 * Task Finite State Machine (FSM)
 *
 * This module enforces strict state transitions for task lifecycle management.
 * Status is the SINGLE SOURCE OF TRUTH for workflow state.
 * Timestamps are metadata only - never used for business logic.
 *
 * All task state transitions MUST go through transitionTask() to ensure:
 * - Only valid transitions are allowed
 * - Stale fields are automatically cleared
 * - Required fields are validated
 * - Transitions are logged for auditing
 */

import type { Doc, Id } from '../_generated/dataModel';
import type { MutationCtx } from '../_generated/server';

// ============================================================================
// TYPE DEFINITIONS
// ============================================================================

/**
 * Task status - single source of truth for workflow state
 */
export type TaskStatus =
  // User message flow
  | 'pending' // Created, waiting for agent
  | 'acknowledged' // Agent claimed via wait-for-task
  | 'in_progress' // Agent started work via task-started
  | 'completed' // Work finished

  // Backlog flow
  | 'backlog' // In backlog tab, not sent yet
  | 'backlog_acknowledged' // Attached to message, visible to agent
  | 'pending_user_review' // Agent done, awaiting user confirmation

  // Common
  | 'queued' // Waiting in queue
  | 'closed'; // Cancelled

export type Task = Doc<'chatroom_tasks'>;

/**
 * FSM transition definition
 */
export interface TransitionRule {
  from: TaskStatus;
  to: TaskStatus;
  trigger: string; // Mutation name that causes this transition
  requiredFields?: (keyof Task)[]; // Fields that must be provided
  setFields?: Partial<Record<keyof Task, 'NOW' | 'PROVIDED'>>; // Fields to auto-set
  clearFields?: (keyof Task)[]; // Fields to clear (set to undefined)
  validate?: (task: Task) => boolean; // Custom validation
}

/**
 * Structured error for invalid transitions
 */
export interface TaskTransitionError {
  code: 'TASK_INVALID_TRANSITION' | 'TASK_VALIDATION_FAILED' | 'TASK_MISSING_REQUIRED_FIELD';
  message: string;
  variables: {
    taskId: string;
    currentStatus?: TaskStatus;
    attemptedStatus?: TaskStatus;
    trigger?: string;
    validTransitions?: {
      to: TaskStatus;
      trigger: string;
      requiredFields?: string[];
    }[];
    missingField?: string;
    validationReason?: string;
  };
  aiGuidance?: string;
}

/**
 * Error thrown when transition is invalid
 */
export class InvalidTransitionError extends Error {
  constructor(public details: TaskTransitionError) {
    super(details.message);
    this.name = 'InvalidTransitionError';
  }
}

// ============================================================================
// FSM CONFIGURATION
// ============================================================================

/**
 * All valid state transitions
 */
const TRANSITIONS: TransitionRule[] = [
  // ==========================================================================
  // USER MESSAGE FLOW: pending → acknowledged → in_progress → completed
  // ==========================================================================

  {
    from: 'pending',
    to: 'acknowledged',
    trigger: 'claimTask',
    requiredFields: ['assignedTo'],
    setFields: {
      acknowledgedAt: 'NOW',
      assignedTo: 'PROVIDED',
    },
    clearFields: [],
  },

  {
    from: 'acknowledged',
    to: 'in_progress',
    trigger: 'startTask',
    setFields: {
      startedAt: 'NOW',
    },
    clearFields: [],
  },

  {
    from: 'in_progress',
    to: 'completed',
    trigger: 'completeTask',
    setFields: {
      completedAt: 'NOW',
    },
    clearFields: [],
  },

  {
    from: 'in_progress',
    to: 'pending_user_review',
    trigger: 'completeTask',
    setFields: {},
    clearFields: [],
  },

  // ==========================================================================
  // BACKLOG FLOW: backlog → backlog_acknowledged → pending_user_review → completed
  // ==========================================================================

  {
    from: 'backlog',
    to: 'backlog_acknowledged',
    trigger: 'attachToMessage',
    requiredFields: ['parentTaskIds'],
    setFields: {
      parentTaskIds: 'PROVIDED',
    },
    clearFields: [],
  },

  {
    from: 'backlog_acknowledged',
    to: 'pending_user_review',
    trigger: 'parentTaskAcknowledged',
    setFields: {},
    clearFields: [],
  },

  {
    from: 'backlog',
    to: 'pending_user_review',
    trigger: 'parentTaskAcknowledged',
    setFields: {},
    clearFields: [],
  },

  {
    from: 'queued',
    to: 'pending_user_review',
    trigger: 'parentTaskAcknowledged',
    setFields: {},
    clearFields: [],
  },

  {
    from: 'pending',
    to: 'pending_user_review',
    trigger: 'parentTaskAcknowledged',
    setFields: {},
    clearFields: [],
  },

  {
    from: 'in_progress',
    to: 'pending_user_review',
    trigger: 'parentTaskAcknowledged',
    setFields: {},
    clearFields: [],
  },

  {
    from: 'pending_user_review',
    to: 'completed',
    trigger: 'markBacklogComplete',
    setFields: {
      completedAt: 'NOW',
    },
    clearFields: [],
  },

  // ==========================================================================
  // REWORK FLOW: pending_user_review → pending
  // ==========================================================================

  {
    from: 'pending_user_review',
    to: 'pending',
    trigger: 'sendBackForRework',
    setFields: {},
    clearFields: ['acknowledgedAt', 'startedAt', 'assignedTo', 'completedAt', 'parentTaskIds'],
  },

  {
    from: 'pending_user_review',
    to: 'queued',
    trigger: 'sendBackForRework',
    setFields: {},
    clearFields: ['acknowledgedAt', 'startedAt', 'assignedTo', 'completedAt', 'parentTaskIds'],
  },

  // ==========================================================================
  // QUEUE PROMOTION: queued → pending
  // ==========================================================================

  {
    from: 'queued',
    to: 'pending',
    trigger: 'promoteNextTask',
    setFields: {},
    clearFields: ['startedAt', 'assignedTo', 'acknowledgedAt'], // Defensive cleanup
  },

  // ==========================================================================
  // BACKLOG TO QUEUE: backlog → pending/queued
  // ==========================================================================

  {
    from: 'backlog',
    to: 'pending',
    trigger: 'moveToQueue',
    setFields: {},
    clearFields: ['startedAt', 'assignedTo', 'completedAt', 'acknowledgedAt'],
  },

  {
    from: 'backlog',
    to: 'queued',
    trigger: 'moveToQueue',
    setFields: {},
    clearFields: ['startedAt', 'assignedTo', 'completedAt', 'acknowledgedAt'],
  },

  // ==========================================================================
  // CANCELLATION: any active state → closed
  // ==========================================================================

  {
    from: 'pending',
    to: 'closed',
    trigger: 'cancelTask',
    setFields: {},
    clearFields: [],
  },

  {
    from: 'acknowledged',
    to: 'closed',
    trigger: 'cancelTask',
    setFields: {},
    clearFields: [],
  },

  {
    from: 'in_progress',
    to: 'closed',
    trigger: 'cancelTask',
    setFields: {},
    clearFields: [],
  },

  {
    from: 'queued',
    to: 'closed',
    trigger: 'cancelTask',
    setFields: {},
    clearFields: [],
  },

  {
    from: 'backlog',
    to: 'closed',
    trigger: 'cancelTask',
    setFields: {},
    clearFields: [],
  },

  {
    from: 'backlog_acknowledged',
    to: 'closed',
    trigger: 'cancelTask',
    setFields: {},
    clearFields: [],
  },

  {
    from: 'pending_user_review',
    to: 'closed',
    trigger: 'cancelTask',
    setFields: {},
    clearFields: [],
  },

  // ==========================================================================
  // RECOVERY: in_progress → pending
  // ==========================================================================

  {
    from: 'in_progress',
    to: 'pending',
    trigger: 'resetStuckTask',
    setFields: {},
    clearFields: ['startedAt', 'assignedTo', 'acknowledgedAt'],
  },

  // ==========================================================================
  // REOPENING: completed/closed → pending_user_review
  // ==========================================================================

  {
    from: 'completed',
    to: 'pending_user_review',
    trigger: 'reopenBacklogTask',
    validate: (task) => task.origin === 'backlog',
    setFields: {},
    clearFields: ['completedAt'],
  },

  {
    from: 'closed',
    to: 'pending_user_review',
    trigger: 'reopenBacklogTask',
    validate: (task) => task.origin === 'backlog',
    setFields: {},
    clearFields: ['completedAt'],
  },

  // ==========================================================================
  // FORCE COMPLETION: pending/acknowledged/in_progress/backlog/queued → completed
  // ==========================================================================

  {
    from: 'pending',
    to: 'completed',
    trigger: 'completeTaskById',
    setFields: {
      completedAt: 'NOW',
    },
    clearFields: [],
  },

  {
    from: 'acknowledged',
    to: 'completed',
    trigger: 'completeTaskById',
    setFields: {
      completedAt: 'NOW',
    },
    clearFields: [],
  },

  {
    from: 'in_progress',
    to: 'completed',
    trigger: 'completeTaskById',
    setFields: {
      completedAt: 'NOW',
    },
    clearFields: [],
  },

  {
    from: 'queued',
    to: 'completed',
    trigger: 'completeTaskById',
    setFields: {
      completedAt: 'NOW',
    },
    clearFields: [],
  },

  {
    from: 'backlog',
    to: 'completed',
    trigger: 'completeTaskById',
    setFields: {
      completedAt: 'NOW',
    },
    clearFields: [],
  },
];

// ============================================================================
// FSM HELPER FUNCTIONS
// ============================================================================

/**
 * Get all valid transitions from a given status
 * Used for error messages and UI guidance
 */
export function getValidTransitionsFrom(status: TaskStatus): TransitionRule[] {
  return TRANSITIONS.filter((t) => t.from === status);
}

/**
 * Check if a transition is valid without executing it
 */
export function canTransition(task: Task, newStatus: TaskStatus): boolean {
  const validTransitions = TRANSITIONS.filter((t) => t.from === task.status && t.to === newStatus);

  if (validTransitions.length === 0) {
    return false;
  }

  // Check custom validation
  for (const transition of validTransitions) {
    if (transition.validate && !transition.validate(task)) {
      continue;
    }
    return true;
  }

  return validTransitions.length > 0;
}

/**
 * Transition a task to a new status with FSM enforcement
 *
 * @param ctx - Mutation context
 * @param taskId - Task to transition
 * @param newStatus - Desired status
 * @param trigger - Name of the mutation causing this transition (for logging)
 * @param overrides - Additional fields to set (beyond FSM defaults)
 * @throws InvalidTransitionError if transition is not allowed
 */
export async function transitionTask(
  ctx: MutationCtx,
  taskId: Id<'chatroom_tasks'>,
  newStatus: TaskStatus,
  trigger: string,
  overrides?: Partial<Task>
): Promise<void> {
  // Get current task
  const task = await ctx.db.get('chatroom_tasks', taskId);
  if (!task) {
    throw new Error(`Task ${taskId} not found`);
  }

  const currentStatus = task.status as TaskStatus;

  // If already in desired status, no-op
  if (currentStatus === newStatus) {
    return;
  }

  // Find valid transition rule
  const validTransitions = TRANSITIONS.filter(
    (t) => t.from === currentStatus && t.to === newStatus && t.trigger === trigger
  );

  if (validTransitions.length === 0) {
    // No valid transition found - throw structured error
    const allValidTransitions = getValidTransitionsFrom(currentStatus);
    throw new InvalidTransitionError({
      code: 'TASK_INVALID_TRANSITION',
      message: `Cannot transition task from ${currentStatus} to ${newStatus} via ${trigger}`,
      variables: {
        taskId,
        currentStatus,
        attemptedStatus: newStatus,
        trigger,
        validTransitions: allValidTransitions.map((t) => ({
          to: t.to,
          trigger: t.trigger,
          requiredFields: t.requiredFields as string[] | undefined,
        })),
      },
      aiGuidance: `Valid transitions from ${currentStatus}: ${allValidTransitions.map((t) => `${t.to} (via ${t.trigger})`).join(', ')}`,
    });
  }

  // Apply first matching transition rule
  const rule = validTransitions[0]!;

  // Custom validation
  if (rule.validate && !rule.validate(task)) {
    throw new InvalidTransitionError({
      code: 'TASK_VALIDATION_FAILED',
      message: `Transition validation failed for ${currentStatus} → ${newStatus}`,
      variables: {
        taskId,
        currentStatus,
        attemptedStatus: newStatus,
        trigger,
        validationReason: 'Custom validation function returned false',
      },
      aiGuidance: 'Check task origin and workflow constraints',
    });
  }

  // Validate required fields
  if (rule.requiredFields) {
    for (const field of rule.requiredFields) {
      if (!overrides || overrides[field] === undefined) {
        throw new InvalidTransitionError({
          code: 'TASK_MISSING_REQUIRED_FIELD',
          message: `Required field '${String(field)}' not provided for transition ${currentStatus} → ${newStatus}`,
          variables: {
            taskId,
            currentStatus,
            attemptedStatus: newStatus,
            trigger,
            missingField: String(field),
          },
          aiGuidance: `This transition requires the following fields: ${rule.requiredFields.map(String).join(', ')}`,
        });
      }
    }
  }

  // Build patch object
  const now = Date.now();
  const patch: Partial<Task> = {
    status: newStatus as any,
    updatedAt: now,
  };

  // Apply setFields rules
  if (rule.setFields) {
    for (const [field, value] of Object.entries(rule.setFields)) {
      if (value === 'NOW') {
        (patch as any)[field] = now;
      } else if (value === 'PROVIDED') {
        // Field must come from overrides (already validated above)
        if (overrides && overrides[field as keyof Task] !== undefined) {
          (patch as any)[field] = overrides[field as keyof Task];
        }
      }
    }
  }

  // Apply clearFields rules
  if (rule.clearFields) {
    for (const field of rule.clearFields) {
      (patch as any)[field] = undefined;
    }
  }

  // Apply overrides (don't override cleared fields)
  if (overrides) {
    for (const [field, value] of Object.entries(overrides)) {
      if (!rule.clearFields || !rule.clearFields.includes(field as keyof Task)) {
        (patch as any)[field] = value;
      }
    }
  }

  // Execute atomic update
  await ctx.db.patch('chatroom_tasks', taskId, patch);

  // Log transition for auditing
  console.log(
    `[FSM] Task ${taskId} transitioned: ${currentStatus} → ${newStatus} (trigger: ${trigger})`
  );
}
