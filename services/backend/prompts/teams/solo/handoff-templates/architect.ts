import type { RoleHandoffContract } from '../../../cli/handoff-templates/contracts';
import { getArchitectToEntryPointHandoffTemplate } from '../../architect-handoff-templates';

export const soloArchitectHandoffContract: RoleHandoffContract = {
  role: 'architect',
  receivesFrom: ['solo'],
  returnsTo: ['solo'],
  outboundTemplates: {
    solo: () => getArchitectToEntryPointHandoffTemplate('solo'),
  },
};
