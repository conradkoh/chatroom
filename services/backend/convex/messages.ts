import { paginationOptsValidator } from 'convex/server';
import { v } from 'convex/values';

import type { Id } from './_generated/dataModel';
import type { MutationCtx } from './_generated/server';
import { mutation, query } from './_generated/server';
import {
  areAllAgentsReady,
  getAndIncrementQueuePosition,
  requireChatroomAccess,
} from './lib/cliSessionAuth';
import { getRolePriority } from './lib/hierarchy';
import { generateRolePrompt, generateTaskStartedReminder } from './prompts';

// =============================================================================
// SHARED HANDLERS - Internal functions that contain the actual logic
// =============================================================================

/**
 * Internal handler for sending a message.
 * Called by both `send` (deprecated) and `sendMessage` (preferred).
 */
async function _sendMessageHandler(
  ctx: MutationCtx,
  args: {
    sessionId: string;
    chatroomId: Id<'chatroom_rooms'>;
    senderRole: string;
    content: string;
    targetRole?: string;
    type: 'message' | 'handoff' | 'interrupt' | 'join';
  }
) {
  // Validate session and check chatroom access (chatroom not needed) - returns chatroom directly
  const { chatroom } = await requireChatroomAccess(ctx, args.sessionId, args.chatroomId);

  // Validate senderRole to prevent impersonation
  // Only allow 'user' or roles that are in the team configuration
  const normalizedSenderRole = args.senderRole.toLowerCase();
  if (normalizedSenderRole !== 'user') {
    // Check if senderRole is in teamRoles
    const teamRoles = chatroom.teamRoles || [];
    const normalizedTeamRoles = teamRoles.map((r) => r.toLowerCase());
    if (!normalizedTeamRoles.includes(normalizedSenderRole)) {
      throw new Error(
        `Invalid senderRole: "${args.senderRole}" is not in team configuration. Allowed roles: ${teamRoles.join(', ') || 'user'}`
      );
    }
  }

  // Determine target role for routing
  let targetRole = args.targetRole;

  // For user messages without explicit target, route to entry point
  if (!targetRole && args.senderRole.toLowerCase() === 'user' && args.type === 'message') {
    if (chatroom?.teamEntryPoint) {
      targetRole = chatroom.teamEntryPoint;
    } else if (chatroom?.teamRoles && chatroom.teamRoles.length > 0) {
      // Default to first role if no entry point specified
      targetRole = chatroom.teamRoles[0];
    }
  }

  const messageId = await ctx.db.insert('chatroom_messages', {
    chatroomId: args.chatroomId,
    senderRole: args.senderRole,
    content: args.content,
    targetRole,
    type: args.type,
  });

  // Update chatroom's lastActivityAt for sorting by recent activity
  await ctx.db.patch('chatroom_rooms', args.chatroomId, {
    lastActivityAt: Date.now(),
  });

  // Auto-create task for user messages and handoff messages
  const isUserMessage = normalizedSenderRole === 'user' && args.type === 'message';
  const isHandoffToAgent =
    args.type === 'handoff' && targetRole && targetRole.toLowerCase() !== 'user';
  const shouldCreateTask = isUserMessage || isHandoffToAgent;

  if (shouldCreateTask) {
    // Get next queue position atomically (prevents race conditions)
    const queuePosition = await getAndIncrementQueuePosition(ctx, chatroom);

    const now = Date.now();

    // Determine task status:
    // - Handoff messages to agents always start as 'pending' (targeted, not queued)
    // - User messages check for existing pending/in_progress tasks
    let taskStatus: 'pending' | 'queued';
    if (isHandoffToAgent) {
      // Handoffs are targeted to a specific agent and should start immediately
      taskStatus = 'pending';
    } else {
      // User messages: check if any task is currently pending or in_progress
      const activeTasks = await ctx.db
        .query('chatroom_tasks')
        .withIndex('by_chatroom', (q) => q.eq('chatroomId', args.chatroomId))
        .filter((q) =>
          q.or(q.eq(q.field('status'), 'pending'), q.eq(q.field('status'), 'in_progress'))
        )
        .first();
      taskStatus = activeTasks ? 'queued' : 'pending';
    }

    // Determine the task creator and assignment
    const createdBy = isHandoffToAgent ? args.senderRole : 'user';
    const assignedTo = isHandoffToAgent ? targetRole : undefined;

    // Create the task
    const taskId = await ctx.db.insert('chatroom_tasks', {
      chatroomId: args.chatroomId,
      createdBy,
      content: args.content,
      status: taskStatus,
      sourceMessageId: messageId,
      createdAt: now,
      updatedAt: now,
      queuePosition,
      assignedTo,
    });

    // Update message with taskId reference
    await ctx.db.patch('chatroom_messages', messageId, { taskId });
  }

  return messageId;
}

// =============================================================================
// PUBLIC MUTATIONS - sendMessage is preferred, send is deprecated
// =============================================================================

/**
 * Send a message to a chatroom.
 * Handles message routing based on sender role and message type.
 * Requires CLI session authentication and chatroom access.
 *
 * @deprecated Use `sendMessage` instead. This method will be removed in a future version.
 */
export const send = mutation({
  args: {
    sessionId: v.string(),
    chatroomId: v.id('chatroom_rooms'),
    senderRole: v.string(),
    content: v.string(),
    targetRole: v.optional(v.string()),
    type: v.union(
      v.literal('message'),
      v.literal('handoff'),
      v.literal('interrupt'),
      v.literal('join')
    ),
  },
  handler: async (ctx, args) => {
    return _sendMessageHandler(ctx, args);
  },
});

/**
 * Internal handler for completing a task and handing off.
 * Called by both `sendHandoff` (deprecated) and `handoff` (preferred).
 */
async function _handoffHandler(
  ctx: MutationCtx,
  args: {
    sessionId: string;
    chatroomId: Id<'chatroom_rooms'>;
    senderRole: string;
    content: string;
    targetRole: string;
  }
) {
  // Validate session and check chatroom access (chatroom not needed) - returns chatroom directly
  const { chatroom } = await requireChatroomAccess(ctx, args.sessionId, args.chatroomId);

  // Validate senderRole
  const normalizedSenderRole = args.senderRole.toLowerCase();
  const teamRoles = chatroom.teamRoles || [];
  const normalizedTeamRoles = teamRoles.map((r) => r.toLowerCase());
  if (!normalizedTeamRoles.includes(normalizedSenderRole)) {
    throw new Error(
      `Invalid senderRole: "${args.senderRole}" is not in team configuration. Allowed roles: ${teamRoles.join(', ')}`
    );
  }

  const normalizedTargetRole = args.targetRole.toLowerCase();
  const isHandoffToUser = normalizedTargetRole === 'user';

  // Validate handoff to user is allowed based on classification
  if (isHandoffToUser) {
    // Get the most recent classified user message to determine restrictions (optimized)
    const recentMessages = await ctx.db
      .query('chatroom_messages')
      .withIndex('by_chatroom', (q) => q.eq('chatroomId', args.chatroomId))
      .order('desc')
      .take(50);

    let currentClassification = null;
    for (const msg of recentMessages) {
      if (msg.senderRole.toLowerCase() === 'user' && msg.classification) {
        currentClassification = msg.classification;
        break;
      }
    }

    // For new_feature requests, builder cannot hand off directly to user
    if (currentClassification === 'new_feature' && normalizedSenderRole === 'builder') {
      // Return error response instead of throwing - allows CLI to handle gracefully
      return {
        success: false,
        error: {
          code: 'HANDOFF_RESTRICTED',
          message:
            'Cannot hand off directly to user. new_feature requests must be reviewed before returning to user.',
          suggestedTarget: 'reviewer',
        },
        messageId: null,
        completedTaskIds: [],
        newTaskId: null,
        promotedTaskId: null,
      };
    }
  }

  const now = Date.now();

  // Step 1: Complete ALL in_progress tasks
  const inProgressTasks = await ctx.db
    .query('chatroom_tasks')
    .withIndex('by_chatroom_status', (q) =>
      q.eq('chatroomId', args.chatroomId).eq('status', 'in_progress')
    )
    .collect();

  const completedTaskIds: Id<'chatroom_tasks'>[] = [];
  for (const task of inProgressTasks) {
    await ctx.db.patch('chatroom_tasks', task._id, {
      status: 'completed',
      completedAt: now,
      updatedAt: now,
    });
    completedTaskIds.push(task._id);
  }

  if (inProgressTasks.length > 1) {
    console.warn(
      `[handoff] Completed ${inProgressTasks.length} in_progress tasks in chatroom ${args.chatroomId}`
    );
  }

  // Step 2: Send the handoff message
  const messageId = await ctx.db.insert('chatroom_messages', {
    chatroomId: args.chatroomId,
    senderRole: args.senderRole,
    content: args.content,
    targetRole: args.targetRole,
    type: 'handoff',
  });

  // Update chatroom's lastActivityAt for sorting by recent activity
  await ctx.db.patch('chatroom_rooms', args.chatroomId, {
    lastActivityAt: now,
  });

  // Step 3: Create task for target agent (if not user)
  let newTaskId: Id<'chatroom_tasks'> | null = null;
  if (!isHandoffToUser) {
    // Get next queue position atomically (prevents race conditions)
    const queuePosition = await getAndIncrementQueuePosition(ctx, chatroom);

    newTaskId = await ctx.db.insert('chatroom_tasks', {
      chatroomId: args.chatroomId,
      createdBy: args.senderRole,
      content: args.content,
      status: 'pending', // Handoffs always start as pending
      sourceMessageId: messageId,
      createdAt: now,
      updatedAt: now,
      queuePosition,
      assignedTo: args.targetRole,
    });

    // Link message to task
    await ctx.db.patch('chatroom_messages', messageId, { taskId: newTaskId });
  }

  // Step 4: Update sender's participant status to waiting (before checking queue promotion)
  const participant = await ctx.db
    .query('chatroom_participants')
    .withIndex('by_chatroom_and_role', (q) =>
      q.eq('chatroomId', args.chatroomId).eq('role', args.senderRole)
    )
    .unique();

  if (participant) {
    await ctx.db.patch('chatroom_participants', participant._id, { status: 'waiting' });
  }

  // Step 5: Promote next queued task only if ALL agents are ready (not active)
  // This ensures queued tasks are only promoted when the team is idle
  let promotedTaskId: Id<'chatroom_tasks'> | null = null;

  // Check if we're handing off to a specific agent (not the queue)
  // Handoffs to specific agents don't trigger queue promotion - the target agent gets a dedicated task
  // Queue promotion only happens when all agents become idle
  if (isHandoffToUser) {
    // When handing off to user, check if all agents are ready for queue promotion
    const allAgentsReady = await areAllAgentsReady(ctx, args.chatroomId);

    if (allAgentsReady) {
      const queuedTasks = await ctx.db
        .query('chatroom_tasks')
        .withIndex('by_chatroom_status', (q) =>
          q.eq('chatroomId', args.chatroomId).eq('status', 'queued')
        )
        .collect();

      if (queuedTasks.length > 0) {
        queuedTasks.sort((a, b) => a.queuePosition - b.queuePosition);
        const nextTask = queuedTasks[0];
        await ctx.db.patch('chatroom_tasks', nextTask._id, {
          status: 'pending',
          updatedAt: now,
        });
        promotedTaskId = nextTask._id;
        console.warn(
          `[handoff] Promoted queued task ${nextTask._id} to pending (all agents ready after handoff to user)`
        );
      }
    } else {
      console.warn(
        `[handoff] Skipping queue promotion - some agents are still active after handoff to user`
      );
    }
  }
  // For handoffs to other agents, no queue promotion - the handoff already creates a pending task for the target

  return {
    success: true,
    error: null,
    messageId,
    completedTaskIds,
    newTaskId,
    promotedTaskId,
  };
}

/**
 * Send a handoff message and complete the current task atomically.
 * This is the preferred way to hand off work between agents.
 *
 * Performs all of these operations in a single atomic transaction:
 * 1. Validates the handoff is allowed (classification rules)
 * 2. Completes all in_progress tasks in the chatroom
 * 3. Sends the handoff message
 * 4. Creates a task for the target agent (if not handing to user)
 * 5. Updates the sender's participant status to waiting
 *
 * Requires CLI session authentication and chatroom access.
 *
 * @deprecated Use `handoff` instead. This method will be removed in a future version.
 */
export const sendHandoff = mutation({
  args: {
    sessionId: v.string(),
    chatroomId: v.id('chatroom_rooms'),
    senderRole: v.string(),
    content: v.string(),
    targetRole: v.string(),
  },
  handler: async (ctx, args) => {
    return _handoffHandler(ctx, args);
  },
});

/**
 * Send a message to a chatroom.
 * Handles message routing based on sender role and message type.
 * Requires CLI session authentication and chatroom access.
 *
 * This is primarily used by agents to send messages without completing their current task,
 * such as asking clarifying questions or providing status updates.
 *
 * Note: Users typically send messages via the WebUI, not the CLI.
 */
export const sendMessage = mutation({
  args: {
    sessionId: v.string(),
    chatroomId: v.id('chatroom_rooms'),
    senderRole: v.string(),
    content: v.string(),
    targetRole: v.optional(v.string()),
    type: v.union(
      v.literal('message'),
      v.literal('handoff'),
      v.literal('interrupt'),
      v.literal('join')
    ),
  },
  handler: async (ctx, args) => {
    return _sendMessageHandler(ctx, args);
  },
});

/**
 * Complete your current task and hand off to the next agent.
 * This is the preferred way to finish work and pass control between agents.
 *
 * Performs all of these operations in a single atomic transaction:
 * 1. Validates the handoff is allowed (classification rules)
 * 2. Completes all in_progress tasks in the chatroom
 * 3. Sends the handoff message
 * 4. Creates a task for the target agent (if not handing to user)
 * 5. Updates the sender's participant status to waiting
 *
 * Requires CLI session authentication and chatroom access.
 */
export const handoff = mutation({
  args: {
    sessionId: v.string(),
    chatroomId: v.id('chatroom_rooms'),
    senderRole: v.string(),
    content: v.string(),
    targetRole: v.string(),
  },
  handler: async (ctx, args) => {
    return _handoffHandler(ctx, args);
  },
});

/**
 * Mark a task as started and classify the user message.
 * Called by agents when they begin working on a user message.
 * Sets the classification which determines allowed handoff paths.
 * Requires CLI session authentication and chatroom access.
 */
export const taskStarted = mutation({
  args: {
    sessionId: v.string(),
    chatroomId: v.id('chatroom_rooms'),
    role: v.string(),
    messageId: v.id('chatroom_messages'),
    classification: v.union(
      v.literal('question'),
      v.literal('new_feature'),
      v.literal('follow_up')
    ),
    // Feature metadata (optional for backward compatibility, required by CLI for new_feature)
    featureTitle: v.optional(v.string()),
    featureDescription: v.optional(v.string()),
    featureTechSpecs: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    // Validate session and check chatroom access (chatroom not needed)
    await requireChatroomAccess(ctx, args.sessionId, args.chatroomId);

    // Get the message to update
    const message = await ctx.db.get('chatroom_messages', args.messageId);
    if (!message) {
      throw new Error('Message not found');
    }

    // Verify the message belongs to this chatroom
    if (message.chatroomId !== args.chatroomId) {
      throw new Error('Message does not belong to this chatroom');
    }

    // Only allow classification of user messages
    if (message.senderRole.toLowerCase() !== 'user') {
      throw new Error('Can only classify user messages');
    }

    // Don't allow re-classification
    if (message.classification) {
      throw new Error('Message is already classified');
    }

    // Update the message with classification and feature metadata
    await ctx.db.patch('chatroom_messages', args.messageId, {
      classification: args.classification,
      ...(args.featureTitle && { featureTitle: args.featureTitle }),
      ...(args.featureDescription && { featureDescription: args.featureDescription }),
      ...(args.featureTechSpecs && { featureTechSpecs: args.featureTechSpecs }),
    });

    // For follow-ups, link to the previous non-follow-up message
    if (args.classification === 'follow_up') {
      // Find the most recent non-follow-up user message (optimized with limit)
      const recentMessages = await ctx.db
        .query('chatroom_messages')
        .withIndex('by_chatroom', (q) => q.eq('chatroomId', args.chatroomId))
        .order('desc')
        .take(100); // Limit to recent messages for performance

      // Find the most recent classified message that is not a follow-up
      let originMessage = null;
      for (const msg of recentMessages) {
        if (
          msg._id !== args.messageId &&
          msg.senderRole.toLowerCase() === 'user' &&
          msg.classification &&
          msg.classification !== 'follow_up'
        ) {
          originMessage = msg;
          break;
        }
      }

      if (originMessage) {
        // Link this follow-up to the original message
        await ctx.db.patch('chatroom_messages', args.messageId, {
          taskOriginMessageId: originMessage._id,
        });
      }
    }

    // Generate a focused reminder for this role + classification
    const reminder = generateTaskStartedReminder(args.role, args.classification, args.chatroomId);

    return { success: true, classification: args.classification, reminder };
  },
});

/**
 * Get allowed handoff roles based on current message classification.
 * Used by CLI to determine valid handoff targets.
 * Requires CLI session authentication and chatroom access.
 */
export const getAllowedHandoffRoles = query({
  args: {
    sessionId: v.string(),
    chatroomId: v.id('chatroom_rooms'),
    role: v.string(),
  },
  handler: async (ctx, args) => {
    // Validate session and check chatroom access (chatroom not needed)
    await requireChatroomAccess(ctx, args.sessionId, args.chatroomId);

    // Get participants
    const participants = await ctx.db
      .query('chatroom_participants')
      .withIndex('by_chatroom', (q) => q.eq('chatroomId', args.chatroomId))
      .collect();

    // Find waiting participants (excluding current role)
    const waitingParticipants = participants.filter(
      (p) => p.status === 'waiting' && p.role.toLowerCase() !== args.role.toLowerCase()
    );

    // Get the most recent classified user message to determine restrictions (optimized)
    const recentMessages = await ctx.db
      .query('chatroom_messages')
      .withIndex('by_chatroom', (q) => q.eq('chatroomId', args.chatroomId))
      .order('desc')
      .take(50);

    // Find the most recent classified user message
    let currentClassification = null;
    for (const msg of recentMessages) {
      if (msg.senderRole.toLowerCase() === 'user' && msg.classification) {
        currentClassification = msg.classification;
        break;
      }
    }

    // Determine allowed handoff roles based on classification
    const availableRoles = waitingParticipants.map((p) => p.role);

    // For new_feature requests, builder cannot hand off directly to user
    // They must go through the reviewer first
    let canHandoffToUser = true;
    let restrictionReason = null;

    if (currentClassification === 'new_feature') {
      const normalizedRole = args.role.toLowerCase();
      // Builder cannot hand directly to user for new features
      if (normalizedRole === 'builder') {
        canHandoffToUser = false;
        restrictionReason = 'new_feature requests must be reviewed before returning to user';
      }
    }

    return {
      availableRoles,
      canHandoffToUser,
      restrictionReason,
      currentClassification,
    };
  },
});

/**
 * List messages in a chatroom.
 * Optionally limit the number of messages returned.
 * Requires CLI session authentication and chatroom access.
 */
export const list = query({
  args: {
    sessionId: v.string(),
    chatroomId: v.id('chatroom_rooms'),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    // Validate session and check chatroom access (chatroom not needed)
    await requireChatroomAccess(ctx, args.sessionId, args.chatroomId);

    const query = ctx.db
      .query('chatroom_messages')
      .withIndex('by_chatroom', (q) => q.eq('chatroomId', args.chatroomId));

    const messages = await query.collect();

    // Enforce maximum limit to prevent unbounded queries
    const MAX_LIMIT = 1000;
    const limit = args.limit ? Math.min(args.limit, MAX_LIMIT) : MAX_LIMIT;

    return messages.slice(-limit);
  },
});

/**
 * List messages in a chatroom with pagination.
 * Returns newest messages first (descending order).
 * Includes task status for messages with linked tasks.
 * Requires CLI session authentication and chatroom access.
 */
export const listPaginated = query({
  args: {
    sessionId: v.string(),
    chatroomId: v.id('chatroom_rooms'),
    paginationOpts: paginationOptsValidator,
  },
  handler: async (ctx, args) => {
    // Validate session and check chatroom access (chatroom not needed)
    await requireChatroomAccess(ctx, args.sessionId, args.chatroomId);

    // Paginate with descending order (newest first)
    const result = await ctx.db
      .query('chatroom_messages')
      .withIndex('by_chatroom', (q) => q.eq('chatroomId', args.chatroomId))
      .order('desc')
      .paginate(args.paginationOpts);

    // Enrich messages with task status
    const enrichedPage = await Promise.all(
      result.page.map(async (message) => {
        if (message.taskId) {
          const task = await ctx.db.get('chatroom_tasks', message.taskId);
          return {
            ...message,
            taskStatus: task?.status,
          };
        }
        return message;
      })
    );

    return {
      ...result,
      page: enrichedPage,
    };
  },
});

/**
 * Get context window for agents.
 * Returns the latest non-follow-up user message and all messages after it.
 * This provides agents with the full context of the current task.
 * Requires CLI session authentication and chatroom access.
 *
 * Optimized approach:
 * 1. Get recent messages (limited fetch)
 * 2. Check if latest user message has taskOriginMessageId (fast path for follow-ups)
 * 3. Otherwise, find origin in recent messages (handles most cases)
 * 4. Fetch messages from origin onwards if needed
 */
export const getContextWindow = query({
  args: {
    sessionId: v.string(),
    chatroomId: v.id('chatroom_rooms'),
  },
  handler: async (ctx, args) => {
    // Validate session and check chatroom access (chatroom not needed)
    await requireChatroomAccess(ctx, args.sessionId, args.chatroomId);

    // Fetch recent messages (limited to 200 for performance)
    // This handles most chatrooms efficiently
    const recentMessages = await ctx.db
      .query('chatroom_messages')
      .withIndex('by_chatroom', (q) => q.eq('chatroomId', args.chatroomId))
      .order('desc')
      .take(200);

    // Reverse to get chronological order
    const messages = recentMessages.reverse();

    if (messages.length === 0) {
      return {
        originMessage: null,
        contextMessages: [],
        classification: null,
      };
    }

    // Fast path: Check if most recent user message has taskOriginMessageId
    // This is set for follow-up messages and points directly to the origin
    for (let i = messages.length - 1; i >= 0; i--) {
      const msg = messages[i];
      if (msg.senderRole.toLowerCase() === 'user' && msg.type === 'message') {
        // If this is a follow-up with origin reference, use it directly
        if (msg.classification === 'follow_up' && msg.taskOriginMessageId) {
          const originMessage = await ctx.db.get('chatroom_messages', msg.taskOriginMessageId);
          if (originMessage) {
            // Find where the origin is in our recent messages, or just return from origin
            const originIndex = messages.findIndex((m) => m._id === originMessage._id);
            if (originIndex !== -1) {
              // Origin is in our recent messages, return from there
              const contextMessages = messages.slice(originIndex);
              return {
                originMessage,
                contextMessages,
                classification: originMessage.classification || null,
              };
            }
            // Origin is older than our recent window - fetch all messages from origin
            // This is rare but handles edge case
            const allMessages = await ctx.db
              .query('chatroom_messages')
              .withIndex('by_chatroom', (q) => q.eq('chatroomId', args.chatroomId))
              .collect();
            const fullOriginIndex = allMessages.findIndex((m) => m._id === originMessage._id);
            const contextMessages =
              fullOriginIndex !== -1 ? allMessages.slice(fullOriginIndex) : allMessages;
            return {
              originMessage,
              contextMessages,
              classification: originMessage.classification || null,
            };
          }
        }

        // This is the origin itself (non-follow-up user message)
        if (msg.classification !== 'follow_up') {
          const contextMessages = messages.slice(i);
          return {
            originMessage: msg,
            contextMessages,
            classification: msg.classification || null,
          };
        }
        break;
      }
    }

    // Standard path: Find the latest non-follow-up user message in recent messages
    let originIndex = -1;
    for (let i = messages.length - 1; i >= 0; i--) {
      const msg = messages[i];
      if (
        msg.senderRole.toLowerCase() === 'user' &&
        msg.type === 'message' &&
        msg.classification !== 'follow_up'
      ) {
        originIndex = i;
        break;
      }
    }

    // If no origin found in recent messages, return recent messages (fallback)
    if (originIndex === -1) {
      return {
        originMessage: null,
        contextMessages: messages,
        classification: null,
      };
    }

    // Get the origin message and all messages after it
    const originMessage = messages[originIndex];
    const contextMessages = messages.slice(originIndex);

    return {
      originMessage,
      contextMessages,
      classification: originMessage?.classification || null,
    };
  },
});

/**
 * Claim a message for a specific role.
 * Used for broadcast messages to prevent multiple agents from processing the same message.
 * Requires CLI session authentication and chatroom access.
 */
export const claimMessage = mutation({
  args: {
    sessionId: v.string(),
    messageId: v.id('chatroom_messages'),
    role: v.string(),
  },
  handler: async (ctx, args) => {
    const message = await ctx.db.get('chatroom_messages', args.messageId);

    if (!message) {
      return false;
    }

    // Validate session and check chatroom access (chatroom not needed)
    await requireChatroomAccess(ctx, args.sessionId, message.chatroomId);

    // Already claimed by someone else
    if (message.claimedByRole && message.claimedByRole !== args.role) {
      return false;
    }

    // Claim the message
    await ctx.db.patch('chatroom_messages', args.messageId, { claimedByRole: args.role });
    return true;
  },
});

/**
 * Get the latest message for a specific role.
 * Used for polling for new messages.
 * Requires CLI session authentication and chatroom access.
 *
 * Message routing logic:
 * 1. Targeted messages (targetRole set): Only the target role receives
 * 2. Interrupt messages: All waiting agents receive
 * 3. User messages: Route to entry point (or first role in team)
 * 4. Broadcast from agents: Highest priority waiting agent receives
 */
export const getLatestForRole = query({
  args: {
    sessionId: v.string(),
    chatroomId: v.id('chatroom_rooms'),
    role: v.string(),
    afterMessageId: v.optional(v.id('chatroom_messages')),
  },
  handler: async (ctx, args) => {
    // Validate session and check chatroom access - returns chatroom directly
    const { chatroom } = await requireChatroomAccess(ctx, args.sessionId, args.chatroomId);

    // Fetch recent messages (optimized with limit)
    const recentMessages = await ctx.db
      .query('chatroom_messages')
      .withIndex('by_chatroom', (q) => q.eq('chatroomId', args.chatroomId))
      .order('desc')
      .take(200);

    // Reverse to get chronological order
    const messages = recentMessages.reverse();

    // Get participants for priority routing
    const participants = await ctx.db
      .query('chatroom_participants')
      .withIndex('by_chatroom', (q) => q.eq('chatroomId', args.chatroomId))
      .collect();

    // Find waiting participants (excluding current role)
    const waitingParticipants = participants.filter(
      (p) => p.status === 'waiting' && p.role.toLowerCase() !== args.role.toLowerCase()
    );

    // Sort by priority to find highest priority waiting
    waitingParticipants.sort((a, b) => getRolePriority(a.role) - getRolePriority(b.role));
    const highestPriorityWaiting = waitingParticipants[0]?.role;

    // Determine entry point for user messages
    const entryPoint = chatroom.teamEntryPoint || chatroom.teamRoles?.[0];

    // Filter messages after the specified ID
    let relevantMessages = messages;
    if (args.afterMessageId) {
      const afterIndex = messages.findIndex((m) => m._id === args.afterMessageId);
      if (afterIndex !== -1) {
        relevantMessages = messages.slice(afterIndex + 1);
      }
    }

    // Find the first unclaimed message for this role
    for (const message of relevantMessages) {
      // Skip if already claimed by someone else
      if (message.claimedByRole && message.claimedByRole !== args.role) {
        continue;
      }

      // Skip join messages
      if (message.type === 'join') {
        continue;
      }

      // Interrupt messages go to everyone
      if (message.type === 'interrupt') {
        return message;
      }

      // Targeted messages only go to target
      if (message.targetRole) {
        if (message.targetRole.toLowerCase() === args.role.toLowerCase()) {
          return message;
        }
        continue;
      }

      // User messages go to entry point
      if (message.senderRole.toLowerCase() === 'user') {
        if (entryPoint && entryPoint.toLowerCase() === args.role.toLowerCase()) {
          return message;
        }
        continue;
      }

      // Broadcast messages from agents go to highest priority waiting
      if (highestPriorityWaiting?.toLowerCase() === args.role.toLowerCase()) {
        return message;
      }
    }

    return null;
  },
});

/**
 * List features in a chatroom.
 * Returns messages classified as new_feature that have feature metadata.
 * Used by agents to discover past features for context.
 * Requires CLI session authentication and chatroom access.
 */
export const listFeatures = query({
  args: {
    sessionId: v.string(),
    chatroomId: v.id('chatroom_rooms'),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    // Validate session and check chatroom access (chatroom not needed)
    await requireChatroomAccess(ctx, args.sessionId, args.chatroomId);

    const limit = args.limit || 10;
    const MAX_LIMIT = 50;
    const effectiveLimit = Math.min(limit, MAX_LIMIT);

    // Get all messages in the chatroom
    const messages = await ctx.db
      .query('chatroom_messages')
      .withIndex('by_chatroom', (q) => q.eq('chatroomId', args.chatroomId))
      .collect();

    // Filter to new_feature messages with feature title
    const features = messages
      .filter((msg) => msg.classification === 'new_feature' && msg.featureTitle)
      .reverse() // Most recent first
      .slice(0, effectiveLimit)
      .map((msg) => ({
        id: msg._id,
        title: msg.featureTitle!,
        descriptionPreview: msg.featureDescription
          ? msg.featureDescription.substring(0, 100) +
            (msg.featureDescription.length > 100 ? '...' : '')
          : undefined,
        createdAt: msg._creationTime,
      }));

    return features;
  },
});

/**
 * Inspect a specific feature.
 * Returns full feature details including tech specs and conversation thread.
 * Used by agents to understand implementation details of past features.
 * Requires CLI session authentication and chatroom access.
 */
export const inspectFeature = query({
  args: {
    sessionId: v.string(),
    chatroomId: v.id('chatroom_rooms'),
    messageId: v.id('chatroom_messages'),
  },
  handler: async (ctx, args) => {
    // Validate session and check chatroom access (chatroom not needed)
    await requireChatroomAccess(ctx, args.sessionId, args.chatroomId);

    // Get the feature message
    const message = await ctx.db.get('chatroom_messages', args.messageId);
    if (!message) {
      throw new Error('Message not found');
    }

    // Verify it belongs to this chatroom
    if (message.chatroomId !== args.chatroomId) {
      throw new Error('Message does not belong to this chatroom');
    }

    // Verify it's a feature
    if (message.classification !== 'new_feature' || !message.featureTitle) {
      throw new Error('Message is not a feature');
    }

    // Get all messages in the chatroom to find the thread
    const allMessages = await ctx.db
      .query('chatroom_messages')
      .withIndex('by_chatroom', (q) => q.eq('chatroomId', args.chatroomId))
      .collect();

    // Find the index of this message
    const messageIndex = allMessages.findIndex((m) => m._id === args.messageId);
    if (messageIndex === -1) {
      throw new Error('Message not found in chatroom');
    }

    // Get all messages after this one until the next non-follow-up user message
    const thread: {
      id: string;
      senderRole: string;
      content: string;
      type: string;
      createdAt: number;
    }[] = [];

    for (let i = messageIndex + 1; i < allMessages.length; i++) {
      const msg = allMessages[i];

      // Stop at the next non-follow-up user message
      if (
        msg.senderRole.toLowerCase() === 'user' &&
        msg.type === 'message' &&
        msg.classification !== 'follow_up'
      ) {
        break;
      }

      thread.push({
        id: msg._id,
        senderRole: msg.senderRole,
        content: msg.content,
        type: msg.type,
        createdAt: msg._creationTime,
      });
    }

    return {
      feature: {
        id: message._id,
        title: message.featureTitle,
        description: message.featureDescription,
        techSpecs: message.featureTechSpecs,
        content: message.content,
        createdAt: message._creationTime,
      },
      thread,
    };
  },
});

/**
 * Get role-specific prompt for an agent.
 * Returns a prompt tailored to the role, current task context, and available actions.
 * Designed to be called with every wait-for-task to provide fresh context.
 * Requires CLI session authentication and chatroom access.
 */
export const getRolePrompt = query({
  args: {
    sessionId: v.string(),
    chatroomId: v.id('chatroom_rooms'),
    role: v.string(),
  },
  handler: async (ctx, args) => {
    // Validate session and check chatroom access (chatroom not needed) - returns chatroom directly
    const { chatroom } = await requireChatroomAccess(ctx, args.sessionId, args.chatroomId);

    // Get participants
    const participants = await ctx.db
      .query('chatroom_participants')
      .withIndex('by_chatroom', (q) => q.eq('chatroomId', args.chatroomId))
      .collect();

    // Find waiting participants (excluding current role)
    const waitingParticipants = participants.filter(
      (p) => p.status === 'waiting' && p.role.toLowerCase() !== args.role.toLowerCase()
    );

    // Get the most recent classified user message to determine restrictions (optimized)
    const recentMessages = await ctx.db
      .query('chatroom_messages')
      .withIndex('by_chatroom', (q) => q.eq('chatroomId', args.chatroomId))
      .order('desc')
      .take(50);

    // Find the most recent classified user message
    let currentClassification: 'question' | 'new_feature' | 'follow_up' | null = null;
    for (const msg of recentMessages) {
      if (msg.senderRole.toLowerCase() === 'user' && msg.classification) {
        currentClassification = msg.classification;
        break;
      }
    }

    // Determine allowed handoff roles based on classification
    const availableRoles = waitingParticipants.map((p) => p.role);

    // For new_feature requests, builder cannot hand off directly to user
    let canHandoffToUser = true;
    let restrictionReason: string | null = null;

    if (currentClassification === 'new_feature') {
      const normalizedRole = args.role.toLowerCase();
      if (normalizedRole === 'builder') {
        canHandoffToUser = false;
        restrictionReason = 'new_feature requests must be reviewed before returning to user';
      }
    }

    // Build the handoff roles list
    const availableHandoffRoles = canHandoffToUser ? [...availableRoles, 'user'] : availableRoles;

    // Generate the role-specific prompt
    const prompt = generateRolePrompt({
      chatroomId: args.chatroomId,
      role: args.role,
      teamName: chatroom.teamName || 'Team',
      teamRoles: chatroom.teamRoles || [],
      teamEntryPoint: chatroom.teamEntryPoint,
      currentClassification,
      availableHandoffRoles,
      canHandoffToUser,
      restrictionReason,
    });

    return {
      prompt,
      currentClassification,
      availableHandoffRoles,
      canHandoffToUser,
      restrictionReason,
    };
  },
});
