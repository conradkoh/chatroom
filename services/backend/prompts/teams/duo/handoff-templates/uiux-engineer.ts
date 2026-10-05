import type { BuiltinTeamRoleHandoffContract } from '../../../cli/handoff-templates/contracts';
import { getUiuxEngineerToEntryPointHandoffTemplate } from '../../uiux-engineer-handoff-templates';

export const duoUiuxEngineerHandoffContract = {
  role: 'uiux-engineer',
  receivesFrom: ['planner'],
  returnsTo: ['planner'],
  outboundTemplates: {
    planner: () => getUiuxEngineerToEntryPointHandoffTemplate('planner'),
  },
} as const satisfies BuiltinTeamRoleHandoffContract<'duo', 'uiux-engineer'>;
