import type { BuiltinTeamRoleHandoffContract } from '../../../cli/handoff-templates/contracts';
import { getUiuxEngineerToEntryPointHandoffTemplate } from '../../uiux-engineer-handoff-templates';

export const soloUiuxEngineerHandoffContract = {
  role: 'uiux-engineer',
  receivesFrom: ['solo'],
  returnsTo: ['solo'],
  outboundTemplates: {
    solo: getUiuxEngineerToEntryPointHandoffTemplate,
  },
} as const satisfies BuiltinTeamRoleHandoffContract<'solo', 'uiux-engineer'>;
