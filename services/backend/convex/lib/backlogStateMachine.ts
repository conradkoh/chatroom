/** Enforces strict lifecycle state transitions for backlog items, ensuring only valid transitions are applied. */

import type { Doc, Id } from '../_generated/dataModel';
import type { MutationCtx } from '../_generated/server';

// ============================================================================
// TYPE DEFINITIONS
// ============================================================================

/**
 * Backlog item status - single source of truth for backlog workflow state
 */
export type BacklogItemStatus =
  | 'backlog' // Sitting in backlog, awaiting pickup
  | 'pending_user_review' // Agent completed work, awaiting user confirmation
  | 'closed' // User closed without completing
  | 'deleted'; // Soft-deleted; retained for referential integrity

export type BacklogItem = Doc<'chatroom_backlog'>;

/**
 * FSM transition definition
 */
export interface BacklogTransitionRule {
  from: BacklogItemStatus;
  to: BacklogItemStatus;
  trigger: string; // Mutation name that causes this transition
  requiredFields?: (keyof BacklogItem)[] | undefined; // Fields that must be provided
  setFields?: Partial<Record<keyof BacklogItem, 'NOW' | 'PROVIDED'>> | undefined; // Fields to auto-set
  clearFields?: (keyof BacklogItem)[] | undefined; // Fields to clear (set to undefined)
  validate?: (item: BacklogItem) => boolean | undefined; // Custom validation
}

/**
 * Structured error for invalid transitions
 */
export interface BacklogTransitionError {
  code:
    'BACKLOG_INVALID_TRANSITION' | 'BACKLOG_VALIDATION_FAILED' | 'BACKLOG_MISSING_REQUIRED_FIELD';
  message: string;
  variables: {
    backlogItemId: string;
    currentStatus?: BacklogItemStatus;
    attemptedStatus?: BacklogItemStatus;
    trigger?: string;
    validTransitions?: {
      to: BacklogItemStatus;
      trigger: string;
      requiredFields?: string[];
    }[];
    missingField?: string;
    validationReason?: string;
  };
  aiGuidance?: string | undefined;
}

/**
 * Error thrown when transition is invalid
 */
export class InvalidBacklogTransitionError extends Error {
  constructor(public details: BacklogTransitionError) {
    super(details.message);
    this.name = 'InvalidBacklogTransitionError';
  }
}

// ============================================================================
// FSM CONFIGURATION
// ============================================================================

/**
 * All valid state transitions:
 * - backlog → pending_user_review (via markBacklogItemForReview)
 * - pending_user_review → closed (via completeBacklogItem)
 * - backlog → closed (via completeBacklogItem — direct completion)
 * - pending_user_review → backlog (via sendBacklogItemBackForRework)
 * - closed → backlog (via reopenBacklogItem)
 * - backlog → closed (via closeBacklogItem)
 * - pending_user_review → closed (via closeBacklogItem)
 */
const TRANSITIONS: BacklogTransitionRule[] = [
  // ==========================================================================
  // AGENT WORK FLOW: backlog → pending_user_review
  // ==========================================================================

  {
    from: 'backlog',
    to: 'pending_user_review',
    trigger: 'markBacklogItemForReview',
    setFields: {
      updatedAt: 'NOW',
    },
  },

  // ==========================================================================
  // USER REVIEW FLOW: pending_user_review → closed
  // ==========================================================================

  {
    from: 'pending_user_review',
    to: 'closed',
    trigger: 'completeBacklogItem',
    setFields: {
      completedAt: 'NOW',
      updatedAt: 'NOW',
    },
  },

  // ==========================================================================
  // DIRECT COMPLETE FLOW: backlog → closed (user marks as done directly)
  // ==========================================================================

  {
    from: 'backlog',
    to: 'closed',
    trigger: 'completeBacklogItem',
    setFields: {
      completedAt: 'NOW',
      updatedAt: 'NOW',
    },
  },

  // ==========================================================================
  // REWORK FLOW: pending_user_review → backlog
  // ==========================================================================

  {
    from: 'pending_user_review',
    to: 'backlog',
    trigger: 'sendBacklogItemBackForRework',
    setFields: {
      updatedAt: 'NOW',
    },
    clearFields: ['completedAt'],
  },

  // ==========================================================================
  // REOPEN FLOW: closed → backlog
  // ==========================================================================

  {
    from: 'closed',
    to: 'backlog',
    trigger: 'reopenBacklogItem',
    setFields: {
      updatedAt: 'NOW',
    },
    clearFields: ['completedAt'],
  },

  // ==========================================================================
  // CLOSE FLOW: backlog → closed
  // ==========================================================================

  {
    from: 'backlog',
    to: 'closed',
    trigger: 'closeBacklogItem',
    setFields: {
      updatedAt: 'NOW',
    },
  },

  // ==========================================================================
  // CLOSE FLOW: pending_user_review → closed (without marking as complete)
  // ==========================================================================

  {
    from: 'pending_user_review',
    to: 'closed',
    trigger: 'closeBacklogItem',
    setFields: {
      updatedAt: 'NOW',
    },
  },
];

// ============================================================================
// FSM HELPER FUNCTIONS
// ============================================================================

/** Returns all valid transitions from a given backlog item status. */
export function getValidTransitionsFrom(status: BacklogItemStatus): BacklogTransitionRule[] {
  return TRANSITIONS.filter((t) => t.from === status);
}

/**
 * Check if a transition is valid without executing it
 */
export function canTransition(item: BacklogItem, newStatus: BacklogItemStatus): boolean {
  const validTransitions = TRANSITIONS.filter((t) => t.from === item.status && t.to === newStatus);

  if (validTransitions.length === 0) {
    return false;
  }

  // Check custom validation — return true only if at least one transition passes
  for (const transition of validTransitions) {
    if (transition.validate && !transition.validate(item)) {
      continue;
    }
    return true;
  }

  return false;
}

/** Transitions a backlog item to a new status, enforcing FSM rules and applying field updates atomically. */
export async function transitionBacklogItem(
  ctx: MutationCtx,
  backlogItemId: Id<'chatroom_backlog'>,
  newStatus: BacklogItemStatus,
  trigger: string,
  overrides?: Partial<BacklogItem>
): Promise<void> {
  // Get current backlog item
  const item = await ctx.db.get('chatroom_backlog', backlogItemId);
  if (!item) {
    throw new Error(`Backlog item ${backlogItemId} not found`);
  }

  const currentStatus = item.status as BacklogItemStatus;

  // Find valid transition rule
  const validTransitions = TRANSITIONS.filter(
    (t) => t.from === currentStatus && t.to === newStatus && t.trigger === trigger
  );

  if (validTransitions.length === 0) {
    // No valid transition found - throw structured error
    const allValidTransitions = getValidTransitionsFrom(currentStatus);
    throw new InvalidBacklogTransitionError({
      code: 'BACKLOG_INVALID_TRANSITION',
      message: `Cannot transition backlog item from ${currentStatus} to ${newStatus} via ${trigger}`,
      variables: {
        backlogItemId,
        currentStatus,
        attemptedStatus: newStatus,
        trigger,
        validTransitions: allValidTransitions.map((t) => ({
          to: t.to,
          trigger: t.trigger,
          ...(t.requiredFields !== undefined
            ? { requiredFields: t.requiredFields as string[] }
            : {}),
        })),
      },
      aiGuidance: `Valid transitions from ${currentStatus}: ${allValidTransitions.map((t) => `${t.to} (via ${t.trigger})`).join(', ')}`,
    });
  }

  // Apply first matching transition rule
  const rule = validTransitions[0];
  if (!rule)
    throw new InvalidBacklogTransitionError({
      code: 'BACKLOG_INVALID_TRANSITION',
      message: `No valid transition from ${currentStatus} to ${newStatus}`,
      variables: { backlogItemId, currentStatus, attemptedStatus: newStatus },
    });

  // Custom validation
  if (rule.validate && !rule.validate(item)) {
    throw new InvalidBacklogTransitionError({
      code: 'BACKLOG_VALIDATION_FAILED',
      message: `Transition validation failed for ${currentStatus} → ${newStatus}`,
      variables: {
        backlogItemId,
        currentStatus,
        attemptedStatus: newStatus,
        trigger,
        validationReason: 'Custom validation function returned false',
      },
      aiGuidance: 'Check backlog item constraints',
    });
  }

  // Validate required fields
  if (rule.requiredFields) {
    for (const field of rule.requiredFields) {
      if (!overrides || overrides[field] === undefined) {
        throw new InvalidBacklogTransitionError({
          code: 'BACKLOG_MISSING_REQUIRED_FIELD',
          message: `Required field '${String(field)}' not provided for transition ${currentStatus} → ${newStatus}`,
          variables: {
            backlogItemId,
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
  const patch: Partial<BacklogItem> & Record<string, unknown> = {
    status: newStatus,
    updatedAt: now,
  };

  // Apply setFields rules
  if (rule.setFields) {
    for (const [field, value] of Object.entries(rule.setFields)) {
      if (value === 'NOW') {
        patch[field] = now;
      } else if (value === 'PROVIDED') {
        // Field must come from overrides (already validated above)
        if (overrides && overrides[field as keyof BacklogItem] !== undefined) {
          patch[field] = overrides[field as keyof BacklogItem];
        }
      }
    }
  }

  // Apply clearFields rules
  if (rule.clearFields) {
    for (const field of rule.clearFields) {
      (patch as Record<string, unknown>)[field] = undefined;
    }
  }

  // Apply overrides (don't override cleared fields)
  if (overrides) {
    for (const [field, value] of Object.entries(overrides)) {
      if (!rule.clearFields || !rule.clearFields.includes(field as keyof BacklogItem)) {
        patch[field] = value;
      }
    }
  }

  // Execute atomic update
  await ctx.db.patch('chatroom_backlog', backlogItemId, patch);

  // Log transition for auditing (suppress during testing)
  if (process.env.NODE_ENV !== 'test') {
    console.warn(
      `[FSM] Backlog item ${backlogItemId} transitioned: ${currentStatus} → ${newStatus} (trigger: ${trigger})`
    );
  }
}
