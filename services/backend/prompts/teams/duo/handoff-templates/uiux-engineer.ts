import type { RoleHandoffContract } from '../../../cli/handoff-templates/contracts';
import { getSpecialistToEntryPointHandoffTemplate } from '../../specialist-handoff-templates';

export const duoUiuxEngineerHandoffContract: RoleHandoffContract = {
  role: 'uiux-engineer',
  receivesFrom: ['planner'],
  returnsTo: ['planner'],
  outboundTemplates: {
    planner: () => getSpecialistToEntryPointHandoffTemplate('planner', 'uiux-engineer'),
  },
};
