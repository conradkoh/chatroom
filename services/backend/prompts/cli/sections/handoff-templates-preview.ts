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

/**
 * Native init: builder delegation brief only (user report template is injected when relevant).
 */
export function getNativeBuilderDelegationPreviewSection(params: {
  teamId?: string;
  role: string;
}): PromptSection | null {
  if (params.role.toLowerCase() !== 'planner') {
    return null;
  }

  const template = getHandoffTemplate({
    teamId: params.teamId,
    fromRole: 'planner',
    toRole: 'builder',
    nativeIntegration: true,
  });
  if (!template) {
    return null;
  }

  const content = [
    '## Builder delegation brief',
    '',
    'Use this template when classifying **new_feature** / **follow_up** work and delegating a slice to the builder:',
    '',
    template,
  ].join('\n');

  return createSection('handoff-templates-native-builder', 'guidance', content);
}
