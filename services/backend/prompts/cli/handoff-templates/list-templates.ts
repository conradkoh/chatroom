/**
 * Handoff template discovery command — deterministic, local, static.
 *
 * No chatroom id and no network calls: the agent lists its role-owned handoff
 * contract (receivesFrom / returnsTo / renderable outbound templates) before
 * work that may require a handoff.
 */

import { listHandoffTemplates, type RoleHandoffTemplateListing } from './index';

/** Concise, copy/paste friendly human-readable listing. */
// fallow-ignore-next-line unused-export
export function formatHandoffTemplateListing(listing: RoleHandoffTemplateListing): string {
  const receives = listing.receivesFrom.length
    ? listing.receivesFrom.map((role) => `\`${role}\``).join(', ')
    : '(none)';
  const returns = listing.returnsTo.length
    ? listing.returnsTo.map((role) => `\`${role}\``).join(', ')
    : '(none)';

  const lines = [
    `Handoff contract for \`${listing.role}\` (team: \`${listing.teamId}\`)`,
    '',
    `Receives from: ${receives}`,
    `Returns to: ${returns}`,
    '',
    'Renderable outbound templates:',
    ...listing.templates.map((template) => `- \`${template.fromRole}\` → \`${template.toRole}\``),
  ];
  return lines.join('\n');
}

/**
 * Resolves and formats a role handoff contract listing.
 *
 * Throws for unknown role/team so the CLI can report a clear nonzero error.
 */
export function listHandoffTemplatesCommand(params: {
  role: string;
  teamId?: string | undefined;
  cliEnvPrefix?: string | undefined;
}): string {
  const listing = listHandoffTemplates({
    role: params.role,
    teamId: params.teamId,
    cliEnvPrefix: params.cliEnvPrefix,
  });
  if (!listing) {
    const teamId = params.teamId ?? 'duo';
    throw new Error(
      `No handoff contract for role "${params.role}" in team "${teamId}". Known roles: planner, builder, enhancer (duo) or solo, enhancer (solo).`
    );
  }
  return formatHandoffTemplateListing(listing);
}
