/**
 * Lazy handoff template hints on native task delivery.
 *
 * Lists which templates apply to the current role and the CLI command to
 * fetch each — avoids repeating large templates on every injection.
 */

import { handoffViewTemplateCommand } from '../cli/handoff/view-template';

/** Handoff targets whose templates are relevant per team:role on native delivery. */
const NATIVE_LAZY_TEMPLATE_TARGETS: Record<string, readonly string[]> = {
  'solo:solo': ['user'],
  'duo:planner': ['user', 'builder'],
  'duo:builder': ['planner'],
  'squad:planner': ['user', 'builder', 'reviewer'],
  'squad:builder': ['reviewer'],
  'squad:reviewer': ['planner', 'builder'],
};

const TEMPLATE_HINTS: Record<string, string> = {
  user: 'final report the user will see',
  builder: 'delegation brief when assigning implementation',
  planner: 'return completed work to the entry-point role',
  reviewer: 'hand off for code review',
};

function getNativeLazyTemplateTargets(teamId: string | undefined, role: string): readonly string[] {
  const key = `${(teamId ?? 'duo').toLowerCase()}:${role.toLowerCase()}`;
  return NATIVE_LAZY_TEMPLATE_TARGETS[key] ?? [];
}

export function appendNativeDeliveryHandoffTemplateHints(
  lines: string[],
  params: { teamId?: string; role: string; cliEnvPrefix: string }
): void {
  const targets = getNativeLazyTemplateTargets(params.teamId, params.role);
  if (targets.length === 0) return;

  lines.push('');
  lines.push('<handoff-templates>');
  lines.push(
    'Before handing off, run **view-template** once for your target — fetch the structure, then compose your handoff message.'
  );
  lines.push('');

  for (const toRole of targets) {
    const hint = TEMPLATE_HINTS[toRole] ?? 'handoff structure';
    const cmd = handoffViewTemplateCommand({
      cliEnvPrefix: params.cliEnvPrefix,
      role: params.role,
      nextRole: toRole,
      teamId: params.teamId,
    });
    lines.push(`- **${toRole}** (${hint}): \`${cmd}\``);
  }

  lines.push('');
  lines.push('</handoff-templates>');
}
