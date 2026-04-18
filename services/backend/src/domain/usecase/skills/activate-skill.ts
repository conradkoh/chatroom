/**
 * activate-skill use case
 *
 * Looks up skill from registry, injects cliEnvPrefix into prompt,
 * checks for skill customizations, and writes a `skill.activated`
 * event to chatroom_eventStream.
 */

import { ConvexError } from 'convex/values';

import { getSkill } from './get-skill';
import type { Doc, Id } from '../../../../convex/_generated/dataModel';
import type { MutationCtx } from '../../../../convex/_generated/server';

/**
 * Map skill ID to customization type.
 * Currently only development_workflow is supported.
 */
function getCustomizationType(skillId: string): string | null {
  const mapping: Record<string, string> = {
    'development-workflow': 'development_workflow',
  };
  return mapping[skillId] ?? null;
}

export interface ActivateSkillArgs {
  chatroomId: Id<'chatroom_rooms'>;
  skillId: string;
  role: string;
  cliEnvPrefix: string;
}

export interface ActivateSkillResult {
  success: true;
  skill: {
    skillId: string;
    name: string;
    description: string;
  };
}

export async function activateSkill(
  ctx: MutationCtx,
  _chatroom: Doc<'chatroom_rooms'>,
  args: ActivateSkillArgs
): Promise<ActivateSkillResult> {
  const skill = getSkill(args.skillId, args.cliEnvPrefix);

  if (!skill) {
    throw new ConvexError(`Skill "${args.skillId}" not found or is disabled.`);
  }

  // Check for custom prompt in chatroom_skillCustomizations
  let prompt = skill.prompt;
  const customizationType = getCustomizationType(args.skillId);
  if (customizationType) {
    const customization = await ctx.db
      .query('chatroom_skillCustomizations')
      .withIndex('by_chatroomId_type', (q) =>
        q.eq('chatroomId', args.chatroomId).eq('type', customizationType as 'development_workflow')
      )
      .first();

    if (customization && customization.isEnabled) {
      prompt = customization.content;
    }
  }

  await ctx.db.insert('chatroom_eventStream', {
    type: 'skill.activated',
    chatroomId: args.chatroomId,
    skillId: skill.skillId,
    skillName: skill.name,
    role: args.role,
    prompt: prompt,
    timestamp: Date.now(),
  });

  return {
    success: true,
    skill: {
      skillId: skill.skillId,
      name: skill.name,
      description: skill.description,
    },
  };
}
