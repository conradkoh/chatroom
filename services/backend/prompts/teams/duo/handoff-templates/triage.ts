import type { BuiltinTeamRoleHandoffContract } from '../../../cli/handoff-templates/contracts';
import { getTriageToEntryPointHandoffTemplate } from '../../triage-handoff-templates';

export const duoTriageHandoffContract = {
  role: 'triage',
  receivesFrom: ['planner'],
  returnsTo: ['planner'],
  outboundTemplates: {
    planner: getTriageToEntryPointHandoffTemplate,
  },
} as const satisfies BuiltinTeamRoleHandoffContract<'duo', 'triage'>;
