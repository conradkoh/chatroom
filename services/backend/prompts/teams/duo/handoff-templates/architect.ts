import type { BuiltinTeamRoleHandoffContract } from '../../../cli/handoff-templates/contracts';
import { getArchitectToEntryPointHandoffTemplate } from '../../architect-handoff-templates';

export const duoArchitectHandoffContract = {
  role: 'architect',
  receivesFrom: ['planner'],
  returnsTo: ['planner'],
  outboundTemplates: {
    planner: () => getArchitectToEntryPointHandoffTemplate('planner'),
  },
} as const satisfies BuiltinTeamRoleHandoffContract<'duo', 'architect'>;
