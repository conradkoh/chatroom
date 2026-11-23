/**
 * Static plan template renderer for `chatroom plan view-template`.
 *
 * A plan has no sender/recipient pair and no conversation mode, so this is a
 * thin wrapper over `getPlanTemplate`.
 */

import { getPlanTemplate, type PlanTemplateParams } from './plan-template';

export function viewPlanTemplate(params: PlanTemplateParams = {}): string {
  return getPlanTemplate(params);
}
