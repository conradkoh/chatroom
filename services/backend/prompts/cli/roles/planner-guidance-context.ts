import { buildPlannerEntryClassificationNote } from './planner-entry-classification';
import type { PlannerGuidanceParams } from '../../types/cli';
import { getCliEnvPrefix } from '../../utils/env';
import { classifyCommand } from '../classify/command';

export function getPlannerGuidanceContext(ctx: PlannerGuidanceParams) {
  const { isEntryPoint, convexUrl, teamRoles, chatroomId, role } = ctx;
  const cliEnvPrefix = getCliEnvPrefix(convexUrl);
  const classifyExample = classifyCommand({ cliEnvPrefix });
  const members = teamRoles;
  const classificationNote =
    isEntryPoint && !ctx.nativeIntegration
      ? buildPlannerEntryClassificationNote(isEntryPoint, cliEnvPrefix, classifyExample)
      : '';

  return {
    ...ctx,
    cliEnvPrefix,
    classifyExample,
    members,
    classificationNote,
    chatroomId,
    role,
  };
}
