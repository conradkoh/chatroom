import type { RoleHandoffContract } from '../../../cli/handoff-templates/contracts';
import { getSpecialistToEntryPointHandoffTemplate } from '../../specialist-handoff-templates';

export const duoArchitectHandoffContract: RoleHandoffContract = {
  role: 'architect',
  receivesFrom: ['planner'],
  returnsTo: ['planner'],
  outboundTemplates: {
    planner: () => getSpecialistToEntryPointHandoffTemplate('planner', 'architect'),
  },
};
