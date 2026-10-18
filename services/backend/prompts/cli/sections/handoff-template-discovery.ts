/**
 * Common handoff template discovery guidance.
 *
 * Tells an agent to view the template for the exact sender → recipient pair
 * before work that may require a handoff. Static: no chatroom id and no
 * network calls.
 *
 * CLI-only: native harnesses inline the handoff templates on each task
 * delivery, so the discovery command is omitted there.
 */

import type { TeamPresetId } from '@workspace/shared/domain/team-kind';

import { listHandoffTemplatePairs } from '../handoff-templates';
import { formatHandoffTemplateCommand } from '../handoff-templates/pair';

export interface HandoffTemplateDiscoveryGuidanceParams {
  teamId?: string | undefined;
  role: string;
  nativeIntegration?: boolean | undefined;
}

export function getHandoffTemplateDiscoveryGuidance(
  params: HandoffTemplateDiscoveryGuidanceParams
): string {
  if (params.nativeIntegration) return '';

  const teamId = params.teamId ?? 'duo';
  const pairs = listHandoffTemplatePairs(teamId, params.role);
  const commands = pairs.length
    ? pairs.map((pair) =>
        formatHandoffTemplateCommand('view-template', pair, '', '<chat|code|code:enhanced>')
      )
    : [
        // Custom team/role: no catalog pairs, so show the placeholder command.
        formatHandoffTemplateCommand(
          'view-template',
          {
            teamId: teamId as TeamPresetId,
            fromRole: '<your-role>',
            toRole: '<recipient-role>',
          },
          '',
          '<chat|code|code:enhanced>'
        ),
      ];

  return `**Pair-keyed handoff templates:** Every handoff template is keyed by sender → recipient; a template written for one recipient must not be reused for another. Before work that may require a handoff, view the template for the exact pair you will send:
\`\`\`bash
${commands.join('\n')}
\`\`\`
All of --from, --to, and --mode are required; use the mode of your current task. This lists who you receive work from, who you return to, and every outbound handoff template you can use.`;
}
