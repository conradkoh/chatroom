import { handoffCommand } from '../cli/handoff/command';
import { getHandoffRecipientVisibilityCallout } from '../native/handoff-visibility';

export type SpecialistHandoffRole = 'architect' | 'uiux-engineer';

function normalizeEntryPointRole(entryPointRole: string): string {
  return entryPointRole.trim().toLowerCase() || 'planner';
}

function getSpecialistLabel(specialistRole: SpecialistHandoffRole): string {
  return specialistRole === 'architect' ? 'Architect' : 'UI/UX Engineer';
}

function getSpecialistFocus(specialistRole: SpecialistHandoffRole): string {
  return specialistRole === 'architect'
    ? 'module boundaries, APIs, schemas, indexes and queries, invariants, failure and recovery handling, tests, and implementation sequence'
    : 'complete user flows, loading/empty/error/success states, component ownership, theme tokens and layout, keyboard and accessibility behavior, responsive details, and UI tests';
}

/** Template for an entry-point role delegating design work to a specialist. */
export function getEntryPointToSpecialistHandoffTemplate(
  entryPointRole: string,
  specialistRole: SpecialistHandoffRole
): string {
  const entryPoint = normalizeEntryPointRole(entryPointRole);
  const specialistLabel = getSpecialistLabel(specialistRole);

  return `${getHandoffRecipientVisibilityCallout(specialistRole)}

## Handoff Template (${entryPoint} → ${specialistRole})

The automatically injected \`<user-message>\` is the authoritative request. Add only concise context that the ${specialistLabel} needs to design within the existing repository and team scope.

Provide the request, relevant constraints, and the files or product surfaces that need inspection. Ask for one evidence-backed design focused on ${getSpecialistFocus(specialistRole)}.

After completing the design, hand it back to \`${entryPoint}\` with the normal handoff command. Stop after the successful handoff; do not implement the design or delegate further work.

\`\`\`bash
${handoffCommand({
  chatroomId: '<chatroom-id>',
  role: specialistRole,
  nextRole: entryPoint,
  cliEnvPrefix: '',
})}
\`\`\``;
}

/** Template for a specialist returning one recommended design to its entry point. */
export function getSpecialistToEntryPointHandoffTemplate(
  entryPointRole: string,
  specialistRole: SpecialistHandoffRole
): string {
  const entryPoint = normalizeEntryPointRole(entryPointRole);
  return renderSpecialistToEntryPointHandoffTemplate(entryPoint, specialistRole);
}

/**
 * Template for a specialist inspecting or recovering its outbound handback
 * without knowing which configured entry point will receive it.
 */
export function getGenericSpecialistToEntryPointHandoffTemplate(
  specialistRole: SpecialistHandoffRole
): string {
  return renderSpecialistToEntryPointHandoffTemplate('<entry-point-role>', specialistRole, true);
}

function renderSpecialistToEntryPointHandoffTemplate(
  entryPoint: string,
  specialistRole: SpecialistHandoffRole,
  generic = false
): string {
  const specialistLabel = getSpecialistLabel(specialistRole);
  const focus = getSpecialistFocus(specialistRole);
  const placeholderInstruction = generic
    ? ' Replace `<entry-point-role>` with the configured entry-point role before running it.'
    : '';

  return `${getHandoffRecipientVisibilityCallout(entryPoint)}

## Handoff Template (${specialistLabel} → Entry Point)

Return exactly one recommended, evidence-backed design for the authoritative user request to the configured entry point. This is an advisory handback: do not implement code, edit files, spawn subagents, present alternatives, or expand scope.

## Evidence and recommendation
- Summarize the repository patterns, components, modules, APIs, and tests inspected.
- State the one chosen design and why the evidence supports it.
- Cover ${focus} at code granularity.
- Identify constraints, risks, verification steps, and the ordered implementation sequence for the team to execute.

## Handoff
Run the normal handoff command to the configured entry point with this complete design, then stop.${placeholderInstruction}

\`\`\`bash
${handoffCommand({
  chatroomId: '<chatroom-id>',
  role: specialistRole,
  nextRole: entryPoint,
  cliEnvPrefix: '',
})}
\`\`\``;
}
