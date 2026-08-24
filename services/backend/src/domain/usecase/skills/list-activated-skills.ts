import type { Id } from '../../../../convex/_generated/dataModel';
import type { QueryCtx } from '../../../../convex/_generated/server';

export interface ActivatedSkillSnapshot {
  skillId: string;
  name: string;
  description: string;
  prompt: string;
}

export async function listActivatedSkills(
  ctx: QueryCtx,
  chatroomId: Id<'chatroom_rooms'>,
  role: string
): Promise<ActivatedSkillSnapshot[]> {
  const rows = await ctx.db
    .query('chatroom_skillActivations')
    .withIndex('by_chatroomId_role', (q) => q.eq('chatroomId', chatroomId).eq('role', role))
    .collect();
  return rows.map(({ skillId, name, description, prompt }) => ({
    skillId,
    name,
    description,
    prompt,
  }));
}
