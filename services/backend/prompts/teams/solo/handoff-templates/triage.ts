import type { RoleHandoffContract } from '../../../cli/handoff-templates/contracts';
import { getTriageToEntryPointHandoffTemplate } from '../../triage-handoff-templates';

export const soloTriageHandoffContract: RoleHandoffContract = {
  role: 'triage',
  receivesFrom: ['solo'],
  returnsTo: ['solo'],
  outboundTemplates: {
    solo: () => getTriageToEntryPointHandoffTemplate('solo'),
  },
};
