import type { BuiltinTeamRoleHandoffContract } from '../../../cli/handoff-templates/contracts';
import { getVerifierToEntryPointHandoffTemplate } from '../../verifier-handoff-templates';

export const duoVerifierHandoffContract = {
  role: 'verifier',
  receivesFrom: ['planner'],
  returnsTo: ['planner'],
  outboundTemplates: {
    planner: () => getVerifierToEntryPointHandoffTemplate('planner'),
  },
} as const satisfies BuiltinTeamRoleHandoffContract<'duo', 'verifier'>;
