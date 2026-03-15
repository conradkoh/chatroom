import { ConvexError, v } from 'convex/values';
import { SessionIdArg } from 'convex-helpers/server/sessions';

import type { Id } from './_generated/dataModel';
import { mutation, query } from './_generated/server';
import type { MutationCtx } from './_generated/server';
import { getAndIncrementQueuePosition, requireChatroomAccess } from './auth/cliSessionAuth';
import { createTask as createTaskUsecase } from '../src/domain/usecase/task/create-task';

// ---------------------------------------------------------------------------
// Built-in skill definitions
// ---------------------------------------------------------------------------

const BUILTIN_SKILLS = [
  {
    skillId: 'backlog-score',
    name: 'Score Backlog',
    description: 'Score all unscored backlog items by complexity, value, and priority.',
    prompt: `You have been activated with the "backlog-score" skill.

Your task: Review all backlog items that do not yet have a complexity, value, or priority score, and score each one.

For each unscored backlog item:
1. Use \`chatroom backlog list --chatroom-id=<id> --role=<role> --status=backlog\` to get the list
2. For each item without scores, use \`chatroom backlog score --chatroom-id=<id> --role=<role> --task-id=<id> --complexity=<low|medium|high> --value=<low|medium|high> --priority=<1-100>\` to apply a score
3. Base your scores on the item's content and its relative importance vs other items

Complete all items before handing off back to the user with a summary of what was scored.`,
  },
  {
    skillId: 'backlog',
    name: 'Backlog Reference',
    description: 'Show all available backlog commands and how to use them.',
    prompt: `You have been activated with the "backlog" skill.

Here is the complete reference for all backlog commands. Replace <id> with your actual chatroom ID and role name.

## Listing
\`\`\`
chatroom backlog list --chatroom-id=<id> --role=<role> --status=<status>
\`\`\`
Status options: \`backlog\` | \`pending\` | \`in_progress\` | \`completed\` | \`pending_review\` | \`all\`
Options: \`--limit=<n>\`, \`--full\` (show full content)

## Adding
\`\`\`
chatroom backlog add --chatroom-id=<id> --role=<role> --content="<content>"
\`\`\`

## Scoring
\`\`\`
chatroom backlog score --chatroom-id=<id> --role=<role> --task-id=<id> \\
  --complexity=<low|medium|high> \\
  --value=<low|medium|high> \\
  --priority=<1-100>
\`\`\`

## Completing
\`\`\`
chatroom backlog complete --chatroom-id=<id> --role=<role> --task-id=<id>
\`\`\`

## Reopening
\`\`\`
chatroom backlog reopen --chatroom-id=<id> --role=<role> --task-id=<id>
\`\`\`

## Marking for Review
\`\`\`
chatroom backlog mark-for-review --chatroom-id=<id> --role=<role> --task-id=<id>
\`\`\`

After reviewing the above reference, hand off back to the user with a brief acknowledgement that you now understand the backlog commands.`,
  },
] as const;

// ---------------------------------------------------------------------------
// Internal helper — NOT a Convex mutation
// ---------------------------------------------------------------------------

/**
 * Upserts all built-in skills for a given chatroom.
 * If a skill already exists (by chatroomId + skillId), it is left unchanged.
 * Called internally by the `activate` mutation (Phase 3).
 */
export async function seedBuiltinSkills(
  ctx: MutationCtx,
  chatroomId: Id<'chatroom_rooms'>
): Promise<void> {
  const now = Date.now();

  for (const skill of BUILTIN_SKILLS) {
    const existing = await ctx.db
      .query('chatroom_skills')
      .withIndex('by_chatroom_skillId', (q) =>
        q.eq('chatroomId', chatroomId).eq('skillId', skill.skillId)
      )
      .unique();

    if (!existing) {
      await ctx.db.insert('chatroom_skills', {
        chatroomId,
        skillId: skill.skillId,
        name: skill.name,
        description: skill.description,
        type: 'builtin',
        isEnabled: true,
        prompt: skill.prompt,
        createdAt: now,
        updatedAt: now,
      });
    }
  }
}

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

/**
 * List all enabled skills for a chatroom.
 * Returns a summary view: { skillId, name, description, type }.
 */
export const list = query({
  args: {
    ...SessionIdArg,
    chatroomId: v.id('chatroom_rooms'),
  },
  handler: async (ctx, args) => {
    await requireChatroomAccess(ctx, args.sessionId, args.chatroomId);

    const skills = await ctx.db
      .query('chatroom_skills')
      .withIndex('by_chatroom', (q) => q.eq('chatroomId', args.chatroomId))
      .filter((q) => q.eq(q.field('isEnabled'), true))
      .collect();

    return skills.map((s) => ({
      skillId: s.skillId,
      name: s.name,
      description: s.description,
      type: s.type,
    }));
  },
});

/**
 * Fetch a single skill by chatroomId + skillId.
 * Returns the full skill document or null if not found.
 */
export const get = query({
  args: {
    ...SessionIdArg,
    chatroomId: v.id('chatroom_rooms'),
    skillId: v.string(),
  },
  handler: async (ctx, args) => {
    await requireChatroomAccess(ctx, args.sessionId, args.chatroomId);

    const skill = await ctx.db
      .query('chatroom_skills')
      .withIndex('by_chatroom_skillId', (q) =>
        q.eq('chatroomId', args.chatroomId).eq('skillId', args.skillId)
      )
      .unique();

    return skill ?? null;
  },
});

// ---------------------------------------------------------------------------
// Mutations
// ---------------------------------------------------------------------------

/**
 * Activate a skill for a chatroom.
 * Seeds built-in skills if not already present, then creates a pending task
 * whose content is the skill's prompt.
 */
export const activate = mutation({
  args: {
    ...SessionIdArg,
    chatroomId: v.id('chatroom_rooms'),
    skillId: v.string(),
    role: v.string(),
  },
  handler: async (ctx, args) => {
    const { chatroom } = await requireChatroomAccess(ctx, args.sessionId, args.chatroomId);

    // Ensure built-in skills exist in the DB
    await seedBuiltinSkills(ctx, args.chatroomId);

    // Look up the requested skill
    const skill = await ctx.db
      .query('chatroom_skills')
      .withIndex('by_chatroom_skillId', (q) =>
        q.eq('chatroomId', args.chatroomId).eq('skillId', args.skillId)
      )
      .unique();

    if (!skill || !skill.isEnabled) {
      throw new ConvexError(`Skill "${args.skillId}" not found or is disabled.`);
    }

    // Get queue position atomically
    const queuePosition = await getAndIncrementQueuePosition(ctx, chatroom);

    // Create a pending task whose content is the skill prompt
    await createTaskUsecase(ctx, {
      chatroomId: args.chatroomId,
      createdBy: args.role,
      content: skill.prompt,
      forceStatus: 'pending',
      queuePosition,
      origin: 'chat',
    });

    return {
      success: true,
      skill: {
        skillId: skill.skillId,
        name: skill.name,
        description: skill.description,
      },
    };
  },
});
