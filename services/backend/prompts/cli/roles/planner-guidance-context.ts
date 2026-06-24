import type { PlannerGuidanceParams } from '../../types/cli';
import { getCliEnvPrefix } from '../../utils/env';

export function getPlannerGuidanceContext(ctx: PlannerGuidanceParams) {
  const { convexUrl, teamRoles, chatroomId, role } = ctx;
  const cliEnvPrefix = getCliEnvPrefix(convexUrl);
  const members = teamRoles;

  return {
    ...ctx,
    cliEnvPrefix,
    members,
    chatroomId,
    role,
  };
}
