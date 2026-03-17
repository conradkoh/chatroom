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
  | 'closed'; // User closed without completing

export type BacklogItem = Doc<'chatroom_backlog'>;

/**
 * FSM transition definition
 */
export interface BacklogTransitionRule {
  from: BacklogItemStatus;
  to: BacklogItemStatus;
  trigger: string; // Mutation name that causes this transition
  requiredFields?: (keyof BacklogItem)[]; // Fields that must be provided
  setFields?: Partial<Record<keyof BacklogItem, 'NOW' | 'PROVIDED'>>; // Fields to auto-set
  clearFields?: (keyof BacklogItem)[]; // Fields to clear (set to undefined)
  validate?: (item: BacklogItem) => boolean; // Custom validation
}

/**
 * Structured error for invalid transitions
 */
export interface BacklogTransitionError {
  code:
    | 'BACKLOG_INVALID_TRANSITION'
    | 'BACKLOG_VALIDATION_FAILED'
    | 'BACKLOG_MISSING_REQUIRED_FIELD';
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
  aiGuidance?: string;
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
 * - pending_user_review → backlog (via sendBacklogItemBackForRework)
 * - closed → backlog (via reopenBacklogItem)
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
  const validTransitions = TRANSITIONS.filter(
    (t) => t.from === item.status && t.to === newStatus
  );

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
          requiredFields: t.requiredFields as string[] | undefined,
        })),
      },
      aiGuidance: `Valid transitions from ${currentStatus}: ${allValidTransitions.map((t) => `${t.to} (via ${t.trigger})`).join(', ')}`,
    });
  }

  // Apply first matching transition rule
  const rule = validTransitions[0]!;

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
  const patch: Partial<BacklogItem> = {
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
        if (overrides && overrides[field as keyof BacklogItem] !== undefined) {
          (patch as any)[field] = overrides[field as keyof BacklogItem];
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
      if (!rule.clearFields || !rule.clearFields.includes(field as keyof BacklogItem)) {
        (patch as any)[field] = value;
      }
    }
  }

  // Execute atomic update
  await ctx.db.patch('chatroom_backlog', backlogItemId, patch);

  // Log transition for auditing (suppress during testing)
  if (process.env.NODE_ENV !== 'test') {
    console.log(
      `[FSM] Backlog item ${backlogItemId} transitioned: ${currentStatus} → ${newStatus} (trigger: ${trigger})`
    );
  }
}
