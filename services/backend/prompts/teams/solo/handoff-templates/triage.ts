import type { BuiltinTeamRoleHandoffContract } from '../../../cli/handoff-templates/contracts';
import { getTriageToEntryPointHandoffTemplate } from '../../triage-handoff-templates';

export const soloTriageHandoffContract = {
  role: 'triage',
  receivesFrom: ['solo'],
  returnsTo: ['solo'],
  outboundTemplates: {
    solo: () => getTriageToEntryPointHandoffTemplate('solo'),
  },
} as const satisfies BuiltinTeamRoleHandoffContract<'solo', 'triage'>;
