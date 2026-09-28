import type { RoleHandoffContract } from '../../../cli/handoff-templates/contracts';
import { getArchitectToEntryPointHandoffTemplate } from '../../architect-handoff-templates';

export const duoArchitectHandoffContract: RoleHandoffContract = {
  role: 'architect',
  receivesFrom: ['planner'],
  returnsTo: ['planner'],
  outboundTemplates: {
    planner: () => getArchitectToEntryPointHandoffTemplate('planner'),
  },
};
