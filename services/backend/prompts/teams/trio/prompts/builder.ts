/**
 * Builder role-specific guidance for the trio team.
 *
 * In the trio team the builder takes file-level briefs from the specifier and
 * hands back to the specifier. The coordinator owns the user conversation, so
 * the builder never hands off to the user or the coordinator.
 */

import { getTrioSharedThreadLine } from './shared-thread';
import { getBuilderGuidance as getBaseBuilderGuidance } from '../../../cli/roles/builder';
import type { BuilderGuidanceParams } from '../../../types/cli';
import { getCliEnvPrefix } from '../../../utils/env';

export function getTrioBuilderGuidance(
  ctx: Omit<BuilderGuidanceParams, 'codeChangesTarget'> & { chatroomId?: string | undefined }
): string {
  const { chatroomId, ...builderParams } = ctx;

  return `**Trio Team Context:**
- You work with a specifier who writes your briefs and reviews your work; the coordinator owns the user conversation and all other coordination
- Your only handoff target is \`specifier\` — never hand off to \`coordinator\`, \`user\`, or any specialist
- Each brief starts you in a fresh session: rely on the brief, and read the thread when it references earlier messages
${getTrioSharedThreadLine({ chatroomId, role: ctx.role, cliEnvPrefix: getCliEnvPrefix(ctx.convexUrl) })}

${getBaseBuilderGuidance({ ...builderParams, teamId: 'trio', questionTarget: 'specifier', codeChangesTarget: 'specifier' })}`;
}
