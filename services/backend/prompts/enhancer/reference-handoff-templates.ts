/**
 * Handoff templates disclosed to the enhancer at spawn time.
 *
 * Split into two parts:
 * - `renderEnhancerOutputTemplateContent` — inner `<handoff-templates>` markdown (output only)
 * - `renderEnhancerReferencesXml` — inner `<references>` XML with per-template wrappers
 */

import { escapeXmlText } from '../attachments/xml.js';
import { getHandoffTemplate } from '../cli/handoff-templates';

export interface RenderEnhancerReferenceHandoffTemplatesParams {
  teamId: string;
  chatroomId: string;
  /** Frozen enhancer→planner template from the job snapshot at enqueue. */
  outputTemplate: string;
  cliEnvPrefix?: string;
  nativeIntegration?: boolean;
}

const DUO_REFERENCE_TARGETS = [
  { fromRole: 'planner', toRole: 'builder' },
  { fromRole: 'planner', toRole: 'user' },
] as const;

const SOLO_REFERENCE_TARGETS = [{ fromRole: 'solo', toRole: 'user' }] as const;

function getReferenceTargets(teamId: string) {
  return teamId.toLowerCase() === 'solo' ? SOLO_REFERENCE_TARGETS : DUO_REFERENCE_TARGETS;
}

/** Inner markdown for `<handoff-templates>` — output contract only. */
export function renderEnhancerOutputTemplateContent(
  params: RenderEnhancerReferenceHandoffTemplatesParams
): string {
  return [
    'Use these structures for this review. Your feedback must follow **Handoff to `planner`** (your output). Use `<references>` handoff templates to assess whether the planner builder draft aligns with final user delivery principles.',
    '',
    '### Handoff to `planner` (your output)',
    params.outputTemplate,
    '',
  ].join('\n');
}

/** Inner XML for `<references>` — planner reference templates only. */
export function renderEnhancerReferencesXml(
  params: RenderEnhancerReferenceHandoffTemplatesParams
): string {
  const targets = getReferenceTargets(params.teamId);
  const blocks: string[] = [];

  for (const target of targets) {
    const template = getHandoffTemplate({
      teamId: params.teamId,
      fromRole: target.fromRole,
      toRole: target.toRole,
      nativeIntegration: params.nativeIntegration ?? true,
      chatroomId: params.chatroomId,
      role: target.fromRole,
      cliEnvPrefix: params.cliEnvPrefix,
    });
    if (!template) continue;

    const forAttr = `${target.fromRole.toLowerCase()}->${target.toRole.toLowerCase()}`;
    const teamAttr = params.teamId.toLowerCase();
    blocks.push(
      `<handoff-template for="${forAttr}" team="${teamAttr}">`,
      escapeXmlText(template),
      '</handoff-template>'
    );
  }

  return blocks.join('\n');
}
