import type { BuiltinTeamRoleHandoffContract } from '../../../cli/handoff-templates/contracts';
import { getUiuxEngineerToEntryPointHandoffTemplate } from '../../uiux-engineer-handoff-templates';

export const soloUiuxEngineerHandoffContract = {
  role: 'uiux-engineer',
  receivesFrom: ['solo'],
  returnsTo: ['solo'],
  outboundTemplates: {
    solo: () => getUiuxEngineerToEntryPointHandoffTemplate('solo'),
  },
} as const satisfies BuiltinTeamRoleHandoffContract<'solo', 'uiux-engineer'>;
