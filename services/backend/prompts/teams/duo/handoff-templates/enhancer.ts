/**
 * Duo enhancer role-owned handoff contract.
 *
 * The duo enhancer receives the request from the planner and returns design
 * input to the planner only.
 */

import { getEnhancerToPlannerHandoffTemplate } from './enhancer-to-planner';
import type { RoleHandoffContract } from '../../../cli/handoff-templates/contracts';

export const duoEnhancerHandoffContract: RoleHandoffContract = {
  role: 'enhancer',
  receivesFrom: ['planner'],
  returnsTo: ['planner'],
  outboundTemplates: {
    planner: () => getEnhancerToPlannerHandoffTemplate(),
  },
};
