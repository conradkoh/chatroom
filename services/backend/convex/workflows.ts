/**
 * Structured Workflow Mutations & Queries
 *
 * DAG-based workflows that agents create, specify, and execute step-by-step.
 * Workflows block user handoff until all steps are completed or the workflow
 * is explicitly exited (cancelled).
 */

import { ConvexError, v } from 'convex/values';
import { SessionIdArg } from 'convex-helpers/server/sessions';

import { mutation, query } from './_generated/server';
import type { Id } from './_generated/dataModel';
import type { MutationCtx, QueryCtx } from './_generated/server';
import { requireChatroomAccess } from './auth/cliSessionAuth';

// ─── Validators ─────────────────────────────────────────────────────

const stepInputValidator = v.object({
  stepKey: v.string(),
  description: v.string(),
  dependsOn: v.array(v.string()),
  order: v.number(),
});

// ─── Internal Helpers ───────────────────────────────────────────────

/** Find a workflow by chatroom + workflowKey or throw. */
async function getWorkflowByKey(
  ctx: QueryCtx | MutationCtx,
  chatroomId: Id<'chatroom_rooms'>,
  workflowKey: string
) {
  const workflow = await ctx.db
    .query('chatroom_workflows')
    .withIndex('by_chatroom_workflowKey', (q) =>
      q.eq('chatroomId', chatroomId).eq('workflowKey', workflowKey)
    )
    .unique();

  if (!workflow) {
    throw new ConvexError({
      code: 'NOT_FOUND',
      message: `Workflow "${workflowKey}" not found in this chatroom`,
    });
  }
  return workflow;
}

/** Find a step by workflow + stepKey or throw. */
async function getStepByKey(
  ctx: QueryCtx | MutationCtx,
  workflowId: Id<'chatroom_workflows'>,
  stepKey: string
) {
  const step = await ctx.db
    .query('chatroom_workflow_steps')
    .withIndex('by_workflow_stepKey', (q) =>
      q.eq('workflowId', workflowId).eq('stepKey', stepKey)
    )
    .unique();

  if (!step) {
    throw new ConvexError({
      code: 'NOT_FOUND',
      message: `Step "${stepKey}" not found in this workflow`,
    });
  }
  return step;
}

/** Get all steps for a workflow. */
async function getAllSteps(ctx: QueryCtx | MutationCtx, workflowId: Id<'chatroom_workflows'>) {
  return await ctx.db
    .query('chatroom_workflow_steps')
    .withIndex('by_workflow', (q) => q.eq('workflowId', workflowId))
    .collect();
}

/**
 * Validate DAG: check for cycles and dangling dependsOn references.
 * Uses Kahn's algorithm (topological sort) for cycle detection.
 */
function validateDag(steps: Array<{ stepKey: string; dependsOn: string[] }>): void {
  const stepKeys = new Set(steps.map((s) => s.stepKey));

  // Check for duplicate step keys
  if (stepKeys.size !== steps.length) {
    throw new ConvexError({
      code: 'VALIDATION_ERROR',
      message: 'Duplicate stepKey values found',
    });
  }

  // Check all dependsOn references exist
  for (const step of steps) {
    for (const dep of step.dependsOn) {
      if (!stepKeys.has(dep)) {
        throw new ConvexError({
          code: 'VALIDATION_ERROR',
          message: `Step "${step.stepKey}" depends on "${dep}" which does not exist`,
        });
      }
      if (dep === step.stepKey) {
        throw new ConvexError({
          code: 'VALIDATION_ERROR',
          message: `Step "${step.stepKey}" cannot depend on itself`,
        });
      }
    }
  }

  // Kahn's algorithm for cycle detection
  const inDegree = new Map<string, number>();
  const adjacency = new Map<string, string[]>();

  for (const key of stepKeys) {
    inDegree.set(key, 0);
    adjacency.set(key, []);
  }

  for (const step of steps) {
    for (const dep of step.dependsOn) {
      adjacency.get(dep)!.push(step.stepKey);
      inDegree.set(step.stepKey, inDegree.get(step.stepKey)! + 1);
    }
  }

  const queue: string[] = [];
  for (const [key, degree] of inDegree) {
    if (degree === 0) queue.push(key);
  }

  let processed = 0;
  while (queue.length > 0) {
    const current = queue.shift()!;
    processed++;
    for (const neighbor of adjacency.get(current)!) {
      const newDegree = inDegree.get(neighbor)! - 1;
      inDegree.set(neighbor, newDegree);
      if (newDegree === 0) queue.push(neighbor);
    }
  }

  if (processed !== stepKeys.size) {
    throw new ConvexError({
      code: 'VALIDATION_ERROR',
      message: 'Workflow DAG contains a cycle',
    });
  }
}

/**
 * After completing or cancelling a step, check if dependent steps can now start
 * and if the workflow itself is complete.
 */
async function advanceWorkflow(
  ctx: MutationCtx,
  workflowId: Id<'chatroom_workflows'>,
  now: number
): Promise<void> {
  const steps = await getAllSteps(ctx, workflowId);

  // NOTE: We build the status snapshot before patching. This is safe because
  // we only promote 'pending' steps — the snapshot correctly reflects the
  // pre-call state of all steps. Newly promoted steps won't be re-evaluated
  // in this same invocation.
  const statusByKey = new Map(steps.map((s) => [s.stepKey, s.status]));

  // Promote pending steps whose dependencies are all completed
  for (const step of steps) {
    if (step.status !== 'pending') continue;

    const allDepsCompleted = step.dependsOn.every((dep) => statusByKey.get(dep) === 'completed');
    if (allDepsCompleted) {
      await ctx.db.patch('chatroom_workflow_steps', step._id, {
        status: 'in_progress',
        updatedAt: now,
      });
    }
  }

  // Check if all steps are terminal (completed or cancelled)
  const allTerminal = steps.every(
    (s) => s.status === 'completed' || s.status === 'cancelled'
  );

  if (allTerminal) {
    await ctx.db.patch('chatroom_workflows', workflowId, {
      status: 'completed',
      completedAt: now,
      updatedAt: now,
    });
  }
}

// ─── Mutations ──────────────────────────────────────────────────────

/**
 * Create a new workflow with steps.
 * Validates the DAG structure (no cycles, no dangling refs).
 * Workflow starts in 'draft' status.
 */
export const createWorkflow = mutation({
  args: {
    ...SessionIdArg,
    chatroomId: v.id('chatroom_rooms'),
    workflowKey: v.string(),
    steps: v.array(stepInputValidator),
    createdBy: v.string(),
  },
  handler: async (ctx, args) => {
    await requireChatroomAccess(ctx, args.sessionId, args.chatroomId);

    // Validate workflowKey uniqueness within chatroom
    const existing = await ctx.db
      .query('chatroom_workflows')
      .withIndex('by_chatroom_workflowKey', (q) =>
        q.eq('chatroomId', args.chatroomId).eq('workflowKey', args.workflowKey)
      )
      .unique();

    if (existing) {
      throw new ConvexError({
        code: 'CONFLICT',
        message: `Workflow "${args.workflowKey}" already exists in this chatroom`,
      });
    }

    // Must have at least one step
    if (args.steps.length === 0) {
      throw new ConvexError({
        code: 'VALIDATION_ERROR',
        message: 'Workflow must have at least one step',
      });
    }

    // Validate DAG
    validateDag(args.steps);

    const now = Date.now();

    // Create workflow
    const workflowId = await ctx.db.insert('chatroom_workflows', {
      chatroomId: args.chatroomId,
      workflowKey: args.workflowKey,
      status: 'draft',
      createdBy: args.createdBy,
      createdAt: now,
      updatedAt: now,
    });

    // Create steps
    for (const step of args.steps) {
      await ctx.db.insert('chatroom_workflow_steps', {
        chatroomId: args.chatroomId,
        workflowId,
        stepKey: step.stepKey,
        description: step.description,
        status: 'pending',
        dependsOn: step.dependsOn,
        order: step.order,
        createdAt: now,
        updatedAt: now,
      });
    }

    return { workflowId };
  },
});

/**
 * Add or update a step specification (goal, requirements, warnings)
 * and optionally assign a role.
 */
export const specifyStep = mutation({
  args: {
    ...SessionIdArg,
    chatroomId: v.id('chatroom_rooms'),
    workflowKey: v.string(),
    stepKey: v.string(),
    assigneeRole: v.optional(v.string()),
    goal: v.string(),
    requirements: v.string(),
    warnings: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await requireChatroomAccess(ctx, args.sessionId, args.chatroomId);

    const workflow = await getWorkflowByKey(ctx, args.chatroomId, args.workflowKey);

    if (workflow.status !== 'draft' && workflow.status !== 'active') {
      throw new ConvexError({
        code: 'INVALID_STATE',
        message: `Cannot specify steps on a ${workflow.status} workflow`,
      });
    }

    const step = await getStepByKey(ctx, workflow._id, args.stepKey);
    const now = Date.now();

    await ctx.db.patch('chatroom_workflow_steps', step._id, {
      assigneeRole: args.assigneeRole,
      specification: {
        goal: args.goal,
        requirements: args.requirements,
        warnings: args.warnings,
      },
      updatedAt: now,
    });

    return { success: true };
  },
});

/**
 * Transition a workflow from 'draft' to 'active'.
 * Steps with no dependencies are immediately moved to 'in_progress'.
 */
export const executeWorkflow = mutation({
  args: {
    ...SessionIdArg,
    chatroomId: v.id('chatroom_rooms'),
    workflowKey: v.string(),
  },
  handler: async (ctx, args) => {
    await requireChatroomAccess(ctx, args.sessionId, args.chatroomId);

    const workflow = await getWorkflowByKey(ctx, args.chatroomId, args.workflowKey);

    if (workflow.status !== 'draft') {
      throw new ConvexError({
        code: 'INVALID_STATE',
        message: `Cannot execute a ${workflow.status} workflow (must be draft)`,
      });
    }

    const now = Date.now();

    // Activate the workflow
    await ctx.db.patch('chatroom_workflows', workflow._id, {
      status: 'active',
      updatedAt: now,
    });

    // Mark root steps (no dependencies) as in_progress
    const steps = await getAllSteps(ctx, workflow._id);
    for (const step of steps) {
      if (step.dependsOn.length === 0) {
        await ctx.db.patch('chatroom_workflow_steps', step._id, {
          status: 'in_progress',
          updatedAt: now,
        });
      }
    }

    return { success: true };
  },
});

/**
 * Mark a step as completed.
 * Automatically promotes dependent steps and completes the workflow if all done.
 */
export const completeStep = mutation({
  args: {
    ...SessionIdArg,
    chatroomId: v.id('chatroom_rooms'),
    workflowKey: v.string(),
    stepKey: v.string(),
  },
  handler: async (ctx, args) => {
    await requireChatroomAccess(ctx, args.sessionId, args.chatroomId);

    const workflow = await getWorkflowByKey(ctx, args.chatroomId, args.workflowKey);

    if (workflow.status !== 'active') {
      throw new ConvexError({
        code: 'INVALID_STATE',
        message: `Cannot complete steps on a ${workflow.status} workflow (must be active)`,
      });
    }

    const step = await getStepByKey(ctx, workflow._id, args.stepKey);

    if (step.status !== 'in_progress') {
      throw new ConvexError({
        code: 'INVALID_STATE',
        message: `Cannot complete step "${args.stepKey}" — status is "${step.status}" (must be in_progress)`,
      });
    }

    const now = Date.now();

    await ctx.db.patch('chatroom_workflow_steps', step._id, {
      status: 'completed',
      completedAt: now,
      updatedAt: now,
    });

    await advanceWorkflow(ctx, workflow._id, now);

    return { success: true };
  },
});

/**
 * Cancel a pending or in_progress step with a reason.
 * Automatically completes the workflow if all steps are now terminal.
 */
export const cancelStep = mutation({
  args: {
    ...SessionIdArg,
    chatroomId: v.id('chatroom_rooms'),
    workflowKey: v.string(),
    stepKey: v.string(),
    reason: v.string(),
  },
  handler: async (ctx, args) => {
    await requireChatroomAccess(ctx, args.sessionId, args.chatroomId);

    const workflow = await getWorkflowByKey(ctx, args.chatroomId, args.workflowKey);

    if (workflow.status !== 'active') {
      throw new ConvexError({
        code: 'INVALID_STATE',
        message: `Cannot cancel steps on a ${workflow.status} workflow (must be active)`,
      });
    }

    const step = await getStepByKey(ctx, workflow._id, args.stepKey);

    if (step.status !== 'pending' && step.status !== 'in_progress') {
      throw new ConvexError({
        code: 'INVALID_STATE',
        message: `Cannot cancel step "${args.stepKey}" — status is "${step.status}" (must be pending or in_progress)`,
      });
    }

    const now = Date.now();

    await ctx.db.patch('chatroom_workflow_steps', step._id, {
      status: 'cancelled',
      cancelledAt: now,
      cancelReason: args.reason,
      updatedAt: now,
    });

    await advanceWorkflow(ctx, workflow._id, now);

    return { success: true };
  },
});

/**
 * Cancel an entire workflow.
 * All non-completed steps are cancelled. Workflow status → 'cancelled'.
 */
export const exitWorkflow = mutation({
  args: {
    ...SessionIdArg,
    chatroomId: v.id('chatroom_rooms'),
    workflowKey: v.string(),
    reason: v.string(),
  },
  handler: async (ctx, args) => {
    await requireChatroomAccess(ctx, args.sessionId, args.chatroomId);

    const workflow = await getWorkflowByKey(ctx, args.chatroomId, args.workflowKey);

    if (workflow.status === 'completed' || workflow.status === 'cancelled') {
      throw new ConvexError({
        code: 'INVALID_STATE',
        message: `Cannot exit a ${workflow.status} workflow`,
      });
    }

    const now = Date.now();

    // Cancel all non-completed steps
    const steps = await getAllSteps(ctx, workflow._id);
    for (const step of steps) {
      if (step.status !== 'completed') {
        await ctx.db.patch('chatroom_workflow_steps', step._id, {
          status: 'cancelled',
          cancelledAt: now,
          cancelReason: args.reason,
          updatedAt: now,
        });
      }
    }

    await ctx.db.patch('chatroom_workflows', workflow._id, {
      status: 'cancelled',
      cancelledAt: now,
      cancelReason: args.reason,
      updatedAt: now,
    });

    return { success: true };
  },
});

// ─── Queries ────────────────────────────────────────────────────────

/**
 * Get the full status of a workflow including all steps and available next steps.
 */
export const getWorkflowStatus = query({
  args: {
    ...SessionIdArg,
    chatroomId: v.id('chatroom_rooms'),
    workflowKey: v.string(),
  },
  handler: async (ctx, args) => {
    await requireChatroomAccess(ctx, args.sessionId, args.chatroomId);

    const workflow = await getWorkflowByKey(ctx, args.chatroomId, args.workflowKey);
    const steps = await getAllSteps(ctx, workflow._id);

    // Sort steps by order for display
    steps.sort((a, b) => a.order - b.order);

    // Compute available next steps: pending steps whose dependencies are all completed
    const statusByKey = new Map(steps.map((s) => [s.stepKey, s.status]));
    const availableNextSteps = steps
      .filter(
        (s) =>
          s.status === 'pending' &&
          s.dependsOn.every((dep) => statusByKey.get(dep) === 'completed')
      )
      .map((s) => s.stepKey);

    return {
      workflow: {
        workflowKey: workflow.workflowKey,
        status: workflow.status,
        createdBy: workflow.createdBy,
        createdAt: workflow.createdAt,
        updatedAt: workflow.updatedAt,
        completedAt: workflow.completedAt,
        cancelledAt: workflow.cancelledAt,
        cancelReason: workflow.cancelReason,
      },
      steps: steps.map((s) => ({
        stepKey: s.stepKey,
        description: s.description,
        status: s.status,
        assigneeRole: s.assigneeRole,
        dependsOn: s.dependsOn,
        order: s.order,
        specification: s.specification,
        completedAt: s.completedAt,
        cancelledAt: s.cancelledAt,
        cancelReason: s.cancelReason,
      })),
      availableNextSteps,
    };
  },
});
