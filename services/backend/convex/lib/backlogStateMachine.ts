/** Domain model for backlog item statuses and lifecycle transitions. */

import type { Doc, Id } from '../_generated/dataModel';
import type { MutationCtx } from '../_generated/server';

// ============================================================================
// TYPE DEFINITIONS
// ============================================================================

/**
 * Backlog item status - single source of truth for backlog workflow state.
 *
 * Lifecycle:
 *   backlog → pending_user_review (agent marks work done)
 *   pending_user_review → closed (user confirms completion)
 *   pending_user_review → backlog (user sends back for rework)
 *   closed → backlog (user reopens)
 */
export type BacklogItemStatus =
  | 'backlog'              // Sitting in backlog, awaiting pickup
  | 'pending_user_review'  // Agent completed work, awaiting user confirmation
  | 'closed';              // User closed (with or without completing)

export type BacklogItem = Doc<'chatroom_backlog'>;

/**
 * FSM transition definition for backlog items
 */
export interface BacklogTransitionRule {
  from: BacklogItemStatus;
  to: BacklogItemStatus;
  trigger: string; // Mutation name that causes this transition
  setFields?: Partial<Record<keyof BacklogItem, 'NOW' | 'CLEAR'>>; // Fields to set or clear
}

/**
 * Structured error for invalid backlog transitions
 */
export interface BacklogTransitionError {
  code: 'BACKLOG_INVALID_TRANSITION';
  message: string;
  variables: {
    itemId: string;
    currentStatus?: BacklogItemStatus;
    attemptedStatus?: BacklogItemStatus;
    trigger?: string;
    validTransitions?: {
      to: BacklogItemStatus;
      trigger: string;
    }[];
  };
  aiGuidance?: string;
}

/**
 * Error thrown when a backlog transition is invalid
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
 * All valid state transitions for backlog items
 */
const BACKLOG_TRANSITIONS: BacklogTransitionRule[] = [
  // backlog → pending_user_review (agent marks work done)
  {
    from: 'backlog',
    to: 'pending_user_review',
    trigger: 'markBacklogItemForReview',
  },

  // pending_user_review → closed (user confirms completion)
  {
    from: 'pending_user_review',
    to: 'closed',
    trigger: 'completeBacklogItem',
    setFields: {
      completedAt: 'NOW',
    },
  },

  // pending_user_review → backlog (user sends back for rework)
  {
    from: 'pending_user_review',
    to: 'backlog',
    trigger: 'sendBacklogItemBackForRework',
  },

  // closed → backlog (user reopens)
  {
    from: 'closed',
    to: 'backlog',
    trigger: 'reopenBacklogItem',
    setFields: {
      completedAt: 'CLEAR',
    },
  },

  // Any status → closed (user closes without completing)
  {
    from: 'backlog',
    to: 'closed',
    trigger: 'closeBacklogItem',
  },

  {
    from: 'pending_user_review',
    to: 'closed',
    trigger: 'closeBacklogItem',
  },
];

// ============================================================================
// FSM HELPER FUNCTIONS
// ============================================================================

/** Returns all valid transitions from a given backlog item status. */
export function getValidBacklogTransitionsFrom(
  status: BacklogItemStatus
): BacklogTransitionRule[] {
  return BACKLOG_TRANSITIONS.filter((t) => t.from === status);
}

/**
 * Check if a backlog transition is valid without executing it
 */
export function canTransitionBacklogItem(
  item: BacklogItem,
  newStatus: BacklogItemStatus
): boolean {
  const validTransitions = BACKLOG_TRANSITIONS.filter(
    (t) => t.from === item.status && t.to === newStatus
  );
  return validTransitions.length > 0;
}

/**
 * Transitions a backlog item to a new status, enforcing FSM rules and applying
 * field updates atomically.
 */
export async function transitionBacklogItem(
  ctx: MutationCtx,
  itemId: Id<'chatroom_backlog'>,
  newStatus: BacklogItemStatus,
  trigger: string
): Promise<void> {
  const item = await ctx.db.get('chatroom_backlog', itemId);
  if (!item) {
    throw new Error(`Backlog item ${itemId} not found`);
  }

  const currentStatus = item.status as BacklogItemStatus;

  // If already in desired status, no-op
  if (currentStatus === newStatus) {
    return;
  }

  // Find valid transition rule
  const validTransitions = BACKLOG_TRANSITIONS.filter(
    (t) => t.from === currentStatus && t.to === newStatus && t.trigger === trigger
  );

  if (validTransitions.length === 0) {
    const allValidTransitions = getValidBacklogTransitionsFrom(currentStatus);
    throw new InvalidBacklogTransitionError({
      code: 'BACKLOG_INVALID_TRANSITION',
      message: `Cannot transition backlog item from '${currentStatus}' to '${newStatus}' via '${trigger}'`,
      variables: {
        itemId,
        currentStatus,
        attemptedStatus: newStatus,
        trigger,
        validTransitions: allValidTransitions.map((t) => ({
          to: t.to,
          trigger: t.trigger,
        })),
      },
      aiGuidance: `Valid transitions from '${currentStatus}': ${allValidTransitions.map((t) => `'${t.to}' (via ${t.trigger})`).join(', ')}`,
    });
  }

  // Apply first matching transition rule
  const rule = validTransitions[0]!;

  // Build patch object
  const now = Date.now();
  const patch: Record<string, unknown> = {
    status: newStatus,
    updatedAt: now,
  };

  // Apply setFields rules
  if (rule.setFields) {
    for (const [field, value] of Object.entries(rule.setFields)) {
      if (value === 'NOW') {
        patch[field] = now;
      } else if (value === 'CLEAR') {
        patch[field] = undefined;
      }
    }
  }

  // Execute atomic update
  await ctx.db.patch('chatroom_backlog', itemId, patch);

  // Log transition for auditing (suppress during testing)
  if (process.env.NODE_ENV !== 'test') {
    console.log(
      `[FSM] Backlog item ${itemId} transitioned: ${currentStatus} → ${newStatus} (trigger: ${trigger})`
    );
  }
}
