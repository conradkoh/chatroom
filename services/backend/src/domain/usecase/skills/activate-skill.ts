/**
 * activate-skill use case
 *
 * Looks up skill from registry, injects cliEnvPrefix into prompt,
 * and creates a pending task with the skill prompt as content.
 */

import { ConvexError } from 'convex/values';

import type { Doc, Id } from '../../../../convex/_generated/dataModel';
import type { MutationCtx } from '../../../../convex/_generated/server';
import { getAndIncrementQueuePosition } from '../../../../convex/auth/cliSessionAuth';
import { createTask as createTaskUsecase } from '../task/create-task';
import { getSkill } from './get-skill';

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
  chatroom: Doc<'chatroom_rooms'>,
  args: ActivateSkillArgs
): Promise<ActivateSkillResult> {
  const skill = getSkill(args.skillId, args.cliEnvPrefix);

  if (!skill) {
    throw new ConvexError(`Skill "${args.skillId}" not found or is disabled.`);
  }

  const queuePosition = await getAndIncrementQueuePosition(ctx, chatroom);

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
}
