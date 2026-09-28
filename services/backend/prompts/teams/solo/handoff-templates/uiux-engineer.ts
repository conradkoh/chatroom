import type { RoleHandoffContract } from '../../../cli/handoff-templates/contracts';
import { getUiuxEngineerToEntryPointHandoffTemplate } from '../../uiux-engineer-handoff-templates';

export const soloUiuxEngineerHandoffContract: RoleHandoffContract = {
  role: 'uiux-engineer',
  receivesFrom: ['solo'],
  returnsTo: ['solo'],
  outboundTemplates: {
    solo: () => getUiuxEngineerToEntryPointHandoffTemplate('solo'),
  },
};
