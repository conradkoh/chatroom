import { handoffCommand } from '../cli/handoff/command';
import { getHandoffRecipientVisibilityCallout } from '../native/handoff-visibility';
import { getFileReferenceGuidanceComment } from '../utils/file-reference-guidance';

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

function getSpecialistRequirements(specialistRole: SpecialistHandoffRole): string {
  if (specialistRole === 'architect') {
    return `
- Cite repository evidence for domain model/entity ownership, lifecycle, invariants, identifiers, and relationships.
- Define service and module boundaries, public and internal APIs, function signatures, and ownership of side effects.
- Analyze concurrency and races: concurrent writers, idempotency, ordering and monotonicity, retries, transactions, and failure/recovery behavior.
- Design read patterns first: primary read paths, indexes, projections/read models, query shapes, scan and transaction limits, and invalidation/subscription scope.
- Account for Convex reactivity and bandwidth: query invalidation patterns, avoiding unnecessary reactive fanout, and separating high-frequency heartbeat/liveness/status fields from low-frequency identity/configuration fields.
- Specify concrete schema, query, and mutation changes; migration/backfill sequence; tests; and verification order.`;
  }

  return `
- Specify complete user flows with explicit loading, empty, error, success, disabled, and retry states where applicable.
- Define exact keyboard shortcuts, focus order, keyboard navigation, focus restoration, and accessible semantics and labels.
- Define component hierarchy and ownership, props/state/events, data boundaries, and interaction behavior.
- Choose concrete existing ShadCN components with the Base UI backend and lucide-react/react-icons conventions; do not write "use an appropriate component."
- Specify Tailwind utility classes or semantic theme-token classes for layout, spacing, sizing, typography, states, responsive behavior, and dark mode.
- Specify responsive breakpoints/layout behavior, visual feedback, destructive-action safeguards, exact files/components, and the UI/integration/accessibility test plan.`;
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
  const sharedContractsHeading =
    !generic && entryPoint === 'planner'
      ? '## Shared contracts (planner-owned)'
      : '## Shared contracts (configured entry-point-owned)';
  const placeholderInstruction = generic
    ? ' Replace `<entry-point-role>` with the configured entry-point role before running it.'
    : '';

  return `${getHandoffRecipientVisibilityCallout(entryPoint)}

## Handoff Template (${specialistLabel} → Entry Point)

Return exactly one recommended, evidence-backed design brief for the authoritative user request to the configured entry point. This is an advisory handback: do not implement code, edit files, spawn subagents, present alternatives, or expand scope. The injected \`<handoff-templates>\` block is the authoritative structure for this handoff; complete every section in order. Use \`Not Applicable.\` only when a section is genuinely inapplicable, with no explanation or filler.

## Summary
<describe the design problem being solved, the repository/product surface where it fits, and the evidence-backed context; do not refer to hidden session text>

## Goal
<state the one-sentence outcome this design delivers>

## Key Knowledge for High Quality Bar
<cite the inspected repository patterns and complete the role-specific checklist below; do not provide a high-level essay>
- Produce exactly one recommended design for ${focus}.
- Name concrete repository paths, existing abstractions, APIs/types, state/data flow, acceptance criteria, risks, and verification steps.
${getSpecialistRequirements(specialistRole)}

## Force Multipliers
<name the existing abstractions, patterns, components, tokens, utilities, and platform conventions to reuse, and state why each reduces implementation risk or duplication>
- Keep the design within the repository's established source-of-truth boundaries and avoid introducing a new registry or abstraction without evidence.

## Files to implement (exhaustive, file-level)
List every file or product surface the implementer must create or modify. Mark each \`(Required)\` or \`(Optional)\`. For every file, give the exact responsibility, exported types/signatures/props/query shape, state/data/event boundaries, and target code or Tailwind/theme-token snippet detailed enough to implement without guessing.
${getFileReferenceGuidanceComment()}

### \`<repo-relative/path.ext>\` (Required)
**Change:** <precise add/modify/remove responsibility and why>

\`\`\`text
// Target code, API/type signature, component skeleton, query shape, or
// Tailwind/theme-token classes. Enough detail that implementation requires no invention.
\`\`\`

<add one block per file; do not collapse multiple files into a directory or vague layer>

${sharedContractsHeading}
<list cross-file interfaces, schemas, API contracts, state/data boundaries, or write exactly \`Not Applicable.\` when genuinely inapplicable>

### Interfaces & types
\`\`\`typescript
// Shared signatures, schemas, props, query/mutation shapes, or state contracts.
\`\`\`

### Reference snippets
\`\`\`typescript
// Canonical imports, call patterns, component wiring, or data-flow examples.
\`\`\`

## Requirements (acceptance criteria)
- <one concrete, verifiable requirement per bullet; include exact behavior, data shape, visual state, or API contract>
- Include repository test coverage for the design's risk areas.
- Verify the implemented user-facing entry point or task-delivery path end-to-end; unit tests alone are insufficient.

## What to avoid
- Do not implement code or edit files as the specialist; this handoff is advisory only.
- Do not present alternative designs, generic advice, or requirements without concrete evidence and file-level consequences.
- Do not invent APIs, schema fields, components, tokens, or source-of-truth locations when existing repository patterns apply.
- <explicit task-specific anti-patterns, scope boundaries, and migration/source-of-truth pitfalls>

## Skills to activate
- <relevant repository skills and why they apply, or write exactly \`Not Applicable.\` when none apply>

## Out of scope
- <explicit files, flows, behavior, or migration work the implementer must not touch>

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
