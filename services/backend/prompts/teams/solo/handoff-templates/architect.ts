import type { RoleHandoffContract } from '../../../cli/handoff-templates/contracts';
import { getSpecialistToEntryPointHandoffTemplate } from '../../specialist-handoff-templates';

export const soloArchitectHandoffContract: RoleHandoffContract = {
  role: 'architect',
  receivesFrom: ['solo'],
  returnsTo: ['solo'],
  outboundTemplates: {
    solo: () => getSpecialistToEntryPointHandoffTemplate('solo', 'architect'),
  },
};
