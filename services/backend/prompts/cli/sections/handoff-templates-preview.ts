import { createSection, type PromptSection } from '../../types/sections';
import { getHandoffTemplate } from '../handoff-templates';

export function getHandoffTemplatesPreviewSection(params: {
  teamId?: string;
  role: string;
  handoffTargets: string[];
  nativeIntegration?: boolean;
}): PromptSection {
  const { teamId, role, handoffTargets, nativeIntegration } = params;
  const blocks: string[] = [
    '## Begin With the End in Mind',
    '',
    'Review the handoff template for who you will hand off to **before** you start work. Your handoff message must follow the template structure.',
  ];

  for (const target of handoffTargets) {
    const template = getHandoffTemplate({
      teamId,
      fromRole: role,
      toRole: target,
      nativeIntegration,
    });
    if (!template) continue;
    blocks.push('');
    blocks.push(`### Handoff to \`${target}\``);
    blocks.push(template);
  }

  return createSection('handoff-templates-preview', 'guidance', blocks.join('\n'));
}
