/**
 * Handoff view-template command generator and template resolver.
 */

import type { CommandContext } from '../../types/cli';
import { getHandoffTemplate } from '../handoff-templates';

export interface HandoffViewTemplateParams extends CommandContext {
  role?: string;
  nextRole?: string;
  teamId?: string;
  nativeIntegration?: boolean;
}

/** Build CLI command to print a handoff template for a role pair. */
// fallow-ignore-next-line complexity
export function handoffViewTemplateCommand(params: HandoffViewTemplateParams): string {
  const prefix = params.cliEnvPrefix || '';
  const role = params.role || '<role>';
  const nextRole = params.nextRole || '<next-role>';
  const teamId = params.teamId ? ` --team-id="${params.teamId}"` : '';
  return `${prefix}chatroom handoff view-template --role="${role}" --next-role="${nextRole}"${teamId}`;
}

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
