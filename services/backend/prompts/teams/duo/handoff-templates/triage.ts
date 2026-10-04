import type { RoleHandoffContract } from '../../../cli/handoff-templates/contracts';
import { getTriageToEntryPointHandoffTemplate } from '../../triage-handoff-templates';

export const duoTriageHandoffContract: RoleHandoffContract = {
  role: 'triage',
  receivesFrom: ['planner'],
  returnsTo: ['planner'],
  outboundTemplates: {
    planner: () => getTriageToEntryPointHandoffTemplate('planner'),
  },
};
