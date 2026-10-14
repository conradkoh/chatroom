import type { BuiltinTeamRoleHandoffContract } from '../../../cli/handoff-templates/contracts';
import { getVerifierToEntryPointHandoffTemplate } from '../../verifier-handoff-templates';

export const soloVerifierHandoffContract = {
  role: 'verifier',
  receivesFrom: ['solo'],
  returnsTo: ['solo'],
  outboundTemplates: {
    solo: () => getVerifierToEntryPointHandoffTemplate('solo'),
  },
} as const satisfies BuiltinTeamRoleHandoffContract<'solo', 'verifier'>;
