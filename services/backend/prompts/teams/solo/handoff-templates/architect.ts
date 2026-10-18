import type { BuiltinTeamRoleHandoffContract } from '../../../cli/handoff-templates/contracts';
import { getArchitectToEntryPointHandoffTemplate } from '../../architect-handoff-templates';

export const soloArchitectHandoffContract = {
  role: 'architect',
  receivesFrom: ['solo'],
  returnsTo: ['solo'],
  outboundTemplates: {
    solo: getArchitectToEntryPointHandoffTemplate,
  },
} as const satisfies BuiltinTeamRoleHandoffContract<'solo', 'architect'>;
