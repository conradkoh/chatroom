import type { RoleHandoffContract } from '../../../cli/handoff-templates/contracts';
import { getSpecialistToEntryPointHandoffTemplate } from '../../specialist-handoff-templates';

export const soloUiuxEngineerHandoffContract: RoleHandoffContract = {
  role: 'uiux-engineer',
  receivesFrom: ['solo'],
  returnsTo: ['solo'],
  outboundTemplates: {
    solo: () => getSpecialistToEntryPointHandoffTemplate('solo', 'uiux-engineer'),
  },
};
