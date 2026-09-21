/**
 * Handoff view-template command generator and template resolver.
 */

import {
  getGenericSpecialistToEntryPointHandoffTemplate,
  type SpecialistHandoffRole,
} from '../../teams/specialist-handoff-templates';
import { getHandoffTemplate } from '../handoff-templates';

// fallow-ignore-next-line complexity
export function viewHandoffTemplate(params: {
  role: string;
  nextRole?: string | undefined;
  teamId?: string | undefined;
  nativeIntegration?: boolean | undefined;
}): string {
  if (params.nextRole === undefined) {
    const role = params.role.trim().toLowerCase();
    if (role === 'architect' || role === 'uiux-engineer') {
      return getGenericSpecialistToEntryPointHandoffTemplate(role as SpecialistHandoffRole);
    }
    throw new Error(
      `Role-only handoff template viewing is supported only for architect or uiux-engineer, not ${params.role}`
    );
  }

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
