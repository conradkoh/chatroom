/**
 * Solo-team enhancer role-owned handoff contract.
 *
 * The shared enhancer prose getters are reused; this contract scopes the
 * enhancer role to the solo team (receives the request from solo, returns
 * design input to solo).
 */

import type { RoleHandoffContract } from '../../../cli/handoff-templates/contracts';
import { getEnhancerToEntryPointHandoffTemplate } from '../../../enhancer/handoff-templates.js';

export const soloEnhancerHandoffContract: RoleHandoffContract = {
  role: 'enhancer',
  receivesFrom: ['solo'],
  returnsTo: ['solo'],
  outboundTemplates: {
    solo: () => getEnhancerToEntryPointHandoffTemplate('solo'),
  },
};
