import type { BuiltinTeamRoleHandoffContract } from '../../../cli/handoff-templates/contracts';
import { getResearcherToEntryPointHandoffTemplate } from '../../researcher-handoff-templates';

export const duoResearcherHandoffContract = {
  role: 'researcher',
  receivesFrom: ['planner'],
  returnsTo: ['planner'],
  outboundTemplates: {
    planner: () => getResearcherToEntryPointHandoffTemplate('planner'),
  },
} as const satisfies BuiltinTeamRoleHandoffContract<'duo', 'researcher'>;
