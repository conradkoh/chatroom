/**
 * Handoff templates disclosed to the enhancer at spawn time.
 *
 * Mirrors planner task-delivery `<handoff-templates>`: output contract plus
 * downstream planner handoffs the enhancer uses to tighten builder delegation.
 */

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

function renderReferenceTemplateBlock(
  params: RenderEnhancerReferenceHandoffTemplatesParams,
  target: { fromRole: string; toRole: string }
): string[] | null {
  const template = getHandoffTemplate({
    teamId: params.teamId,
    fromRole: target.fromRole,
    toRole: target.toRole,
    nativeIntegration: params.nativeIntegration ?? true,
    chatroomId: params.chatroomId,
    role: target.fromRole,
    cliEnvPrefix: params.cliEnvPrefix,
  });
  if (!template) return null;
  return [`### Handoff to \`${target.toRole}\` (planner reference)`, template, ''];
}

/** Inner markdown for `<handoff-templates>` (wrapper added by task envelope). */
export function renderEnhancerReferenceHandoffTemplatesContent(
  params: RenderEnhancerReferenceHandoffTemplatesParams
): string {
  const blocks = [
    'Use these structures for this review. Your feedback must follow **Handoff to `planner`** (your output). Use **Handoff to `builder`** and **Handoff to `user`** to assess whether the planner builder draft aligns with final user delivery principles.',
    '',
    '### Handoff to `planner` (your output)',
    params.outputTemplate,
    '',
    ...getReferenceTargets(params.teamId).flatMap(
      (target) => renderReferenceTemplateBlock(params, target) ?? []
    ),
  ];
  return blocks.join('\n');
}
