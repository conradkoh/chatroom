import type { RoleHandoffContract } from '../../../cli/handoff-templates/contracts';
import { getUiuxEngineerToEntryPointHandoffTemplate } from '../../uiux-engineer-handoff-templates';

export const duoUiuxEngineerHandoffContract: RoleHandoffContract = {
  role: 'uiux-engineer',
  receivesFrom: ['planner'],
  returnsTo: ['planner'],
  outboundTemplates: {
    planner: () => getUiuxEngineerToEntryPointHandoffTemplate('planner'),
  },
};
