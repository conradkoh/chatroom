/**
 * Handoff view-template command generator and template resolver.
 */

import { getHandoffTemplate } from '../handoff-templates';

export function viewHandoffTemplate(params: {
  role: string;
  nextRole: string;
  teamId?: string;
  nativeIntegration?: boolean;
}): string {
  const template = getHandoffTemplate({
    fromRole: params.role,
    toRole: params.nextRole,
    teamId: params.teamId,
    nativeIntegration: params.nativeIntegration ?? true,
  });
  if (!template) {
    throw new Error(`No handoff template for ${params.role} → ${params.nextRole}`);
  }
  return template;
}
