import { v } from 'convex/values';

import { mutation, query } from './_generated/server';
import { requireChatroomAccess } from './lib/cliSessionAuth';
import { getRolePriority } from './lib/hierarchy';

/**
 * Send a message to a chatroom.
 * Handles message routing based on sender role and message type.
 * Requires CLI session authentication and chatroom access.
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
    // Validate session and check chatroom access
    await requireChatroomAccess(ctx, args.sessionId, args.chatroomId);

    // Get chatroom to check team configuration
    const chatroom = await ctx.db.get('chatroom_rooms', args.chatroomId);
    if (!chatroom) {
      throw new Error('Chatroom not found');
    }

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

    return messageId;
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
  },
  handler: async (ctx, args) => {
    // Validate session and check chatroom access
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

    // Update the message with classification
    await ctx.db.patch('chatroom_messages', args.messageId, {
      classification: args.classification,
    });

    // For follow-ups, link to the previous non-follow-up message
    if (args.classification === 'follow_up') {
      // Find the most recent non-follow-up user message
      const messages = await ctx.db
        .query('chatroom_messages')
        .withIndex('by_chatroom', (q) => q.eq('chatroomId', args.chatroomId))
        .collect();

      // Find the most recent classified message that is not a follow-up
      let originMessage = null;
      for (let i = messages.length - 1; i >= 0; i--) {
        const msg = messages[i];
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

    return { success: true, classification: args.classification };
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
    // Validate session and check chatroom access
    await requireChatroomAccess(ctx, args.sessionId, args.chatroomId);

    // Get chatroom for team info
    const chatroom = await ctx.db.get('chatroom_rooms', args.chatroomId);
    if (!chatroom) {
      throw new Error('Chatroom not found');
    }

    // Get participants
    const participants = await ctx.db
      .query('chatroom_participants')
      .withIndex('by_chatroom', (q) => q.eq('chatroomId', args.chatroomId))
      .collect();

    // Find waiting participants (excluding current role)
    const waitingParticipants = participants.filter(
      (p) => p.status === 'waiting' && p.role.toLowerCase() !== args.role.toLowerCase()
    );

    // Get the most recent classified user message to determine restrictions
    const messages = await ctx.db
      .query('chatroom_messages')
      .withIndex('by_chatroom', (q) => q.eq('chatroomId', args.chatroomId))
      .collect();

    // Find the most recent classified user message
    let currentClassification = null;
    for (let i = messages.length - 1; i >= 0; i--) {
      const msg = messages[i];
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
    // Validate session and check chatroom access
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
 * Get context window for agents.
 * Returns the latest non-follow-up user message and all messages after it.
 * This provides agents with the full context of the current task.
 * Requires CLI session authentication and chatroom access.
 */
export const getContextWindow = query({
  args: {
    sessionId: v.string(),
    chatroomId: v.id('chatroom_rooms'),
  },
  handler: async (ctx, args) => {
    // Validate session and check chatroom access
    await requireChatroomAccess(ctx, args.sessionId, args.chatroomId);

    const messages = await ctx.db
      .query('chatroom_messages')
      .withIndex('by_chatroom', (q) => q.eq('chatroomId', args.chatroomId))
      .collect();

    // Find the index of the latest non-follow-up user message
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

    // If no origin found, return all messages (fallback)
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

    // Validate session and check chatroom access
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
    // Validate session and check chatroom access
    await requireChatroomAccess(ctx, args.sessionId, args.chatroomId);

    const messages = await ctx.db
      .query('chatroom_messages')
      .withIndex('by_chatroom', (q) => q.eq('chatroomId', args.chatroomId))
      .collect();

    // Get chatroom for team info
    const chatroom = await ctx.db.get('chatroom_rooms', args.chatroomId);

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
    const entryPoint = chatroom?.teamEntryPoint || chatroom?.teamRoles?.[0];

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
