/**
 * Handoff templates eagerly inlined on native task delivery.
 *
 * Gives each role the structures it needs before work starts — final user
 * accountability, delegation format, or return handoffs — without CLI
 * listen-loop framing.
 */

import { getHandoffTemplate } from '../cli/handoff-templates';

/** toRole targets to inline per team:role on native task delivery. */
const NATIVE_DELIVERY_TEMPLATE_TARGETS: Record<string, readonly string[]> = {
  'solo:solo': ['user'],
  'duo:planner': ['user', 'builder'],
  'duo:builder': ['planner'],
};

function getNativeDeliveryTemplateTargets(
  teamId: string | undefined,
  role: string
): readonly string[] {
  const key = `${(teamId ?? 'duo').toLowerCase()}:${role.toLowerCase()}`;
  return NATIVE_DELIVERY_TEMPLATE_TARGETS[key] ?? [];
}

function renderNativeDeliveryTemplateBlock(
  params: { teamId?: string; role: string; chatroomId?: string; cliEnvPrefix?: string },
  toRole: string
): string[] | null {
  const template = getHandoffTemplate({
    teamId: params.teamId,
    fromRole: params.role,
    toRole,
    nativeIntegration: true,
    chatroomId: params.chatroomId,
    role: params.role,
    cliEnvPrefix: params.cliEnvPrefix,
  });
  if (!template) return null;
  return [`### Handoff to \`${toRole}\``, template, ''];
}

export function appendNativeDeliveryHandoffTemplates(
  lines: string[],
  params: { teamId?: string; role: string; chatroomId?: string; cliEnvPrefix?: string }
): void {
  const targets = getNativeDeliveryTemplateTargets(params.teamId, params.role);
  const blocks = targets.flatMap(
    (toRole) => renderNativeDeliveryTemplateBlock(params, toRole) ?? []
  );
  if (blocks.length === 0) return;

  lines.push('');
  lines.push('<handoff-templates>');
  lines.push('Use these structures when handing off.');
  lines.push('');
  lines.push(...blocks);
  lines.push('</handoff-templates>');
}
