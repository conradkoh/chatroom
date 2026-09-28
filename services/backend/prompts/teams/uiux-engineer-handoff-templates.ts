import { handoffCommand } from '../cli/handoff/command';
import { getHandoffRecipientVisibilityCallout } from '../native/handoff-visibility';
import { getFileReferenceGuidanceComment } from '../utils/file-reference-guidance';

function normalizeEntryPointRole(entryPointRole: string): string {
  return entryPointRole.trim().toLowerCase() || 'planner';
}

function getUiuxEngineerFocus(): string {
  return 'complete user flows, loading/empty/error/success states, component ownership, theme tokens and layout, keyboard and accessibility behavior, responsive details, and UI tests';
}

function getUiuxEngineerRequirements(): string {
  return `
- Specify complete user flows with explicit loading, empty, error, success, disabled, and retry states where applicable.
- Define exact keyboard shortcuts, focus order, keyboard navigation, focus restoration, and accessible semantics and labels.
- Define component hierarchy and ownership, props/state/events, data boundaries, and interaction behavior.
- Choose concrete existing ShadCN components with the Base UI backend and lucide-react/react-icons conventions; do not write "use an appropriate component."
- Specify Tailwind utility classes or semantic theme-token classes for layout, spacing, sizing, typography, states, responsive behavior, and dark mode.
- Specify responsive breakpoints/layout behavior, visual feedback, destructive-action safeguards, exact files/components, and the UI/integration/accessibility test plan.`;
}

/** Template for an entry-point role delegating design work to the UI/UX engineer. */
export function getEntryPointToUiuxEngineerHandoffTemplate(entryPointRole: string): string {
  const entryPoint = normalizeEntryPointRole(entryPointRole);

  return `${getHandoffRecipientVisibilityCallout('uiux-engineer')}

## Handoff Template (${entryPoint} → uiux-engineer)

The automatically injected \`<user-message>\` is the authoritative request. Add only concise context that the UI/UX Engineer needs to design within the existing repository and team scope.

Provide the request, relevant constraints, and the files or product surfaces that need inspection. Ask for one evidence-backed design focused on ${getUiuxEngineerFocus()}.

After completing the design, hand it back to \`${entryPoint}\` with the normal handoff command. Stop after the successful handoff; do not implement the design or delegate further work.

\`\`\`bash
${handoffCommand({
  chatroomId: '<chatroom-id>',
  role: 'uiux-engineer',
  nextRole: entryPoint,
  cliEnvPrefix: '',
})}
\`\`\``;
}

/** Template for the UI/UX engineer returning one recommended design to its entry point. */
export function getUiuxEngineerToEntryPointHandoffTemplate(entryPointRole: string): string {
  return renderUiuxEngineerToEntryPointHandoffTemplate(normalizeEntryPointRole(entryPointRole));
}

/** Template for inspecting the UI/UX engineer handback without a configured target. */
export function getGenericUiuxEngineerToEntryPointHandoffTemplate(): string {
  return renderUiuxEngineerToEntryPointHandoffTemplate('<entry-point-role>', true);
}

function renderUiuxEngineerToEntryPointHandoffTemplate(
  entryPoint: string,
  generic = false
): string {
  const sharedContractsHeading =
    !generic && entryPoint === 'planner'
      ? '## Shared contracts (planner-owned)'
      : '## Shared contracts (configured entry-point-owned)';
  const placeholderInstruction = generic
    ? ' Replace `<entry-point-role>` with the configured entry-point role before running it.'
    : '';

  return `${getHandoffRecipientVisibilityCallout(entryPoint)}

## Handoff Template (UI/UX Engineer → Entry Point)

Return exactly one recommended, evidence-backed design brief for the authoritative user request to the configured entry point. This is an advisory handback: do not implement code, edit files, spawn subagents, present alternatives, or expand scope. The injected \`<handoff-templates>\` block is the authoritative structure for this handoff; complete every section in order. Use \`Not Applicable.\` only when a section is genuinely inapplicable, with no explanation or filler.

## Summary
<describe the design problem being solved, the repository/product surface where it fits, and the evidence-backed context; do not refer to hidden session text>

## Goal
<state the one-sentence outcome this design delivers>

## Key Knowledge for High Quality Bar
<cite the inspected repository patterns and complete the UI/UX engineer checklist below; do not provide a high-level essay>
- Produce exactly one recommended design for ${getUiuxEngineerFocus()}.
- Name concrete repository paths, existing components/tokens, props/state/events, data boundaries, acceptance criteria, risks, and verification steps.
${getUiuxEngineerRequirements()}

## Force Multipliers
<name the existing components, patterns, tokens, utilities, and platform conventions to reuse, and state why each reduces implementation risk or duplication>
- Keep the design within the repository's established source-of-truth boundaries and avoid introducing a new registry or abstraction without evidence.

## Files to implement (exhaustive, file-level)
List every file or product surface the implementer must create or modify. Mark each \`(Required)\` or \`(Optional)\`. For every file, give the exact responsibility, exported types/signatures/props, state/data/event boundaries, component hierarchy, and target Tailwind/theme-token snippet detailed enough to implement without guessing.
${getFileReferenceGuidanceComment()}

### \`<repo-relative/path.ext>\` (Required)
**Change:** <precise add/modify/remove responsibility and why>

\`\`\`text
// Component hierarchy, props/state/events, test structure, or exact
// Tailwind/theme-token classes. Enough detail that implementation requires no invention.
\`\`\`

<add one block per file; do not collapse multiple files into a directory or vague layer>

${sharedContractsHeading}
<list cross-file interfaces, component/data contracts, state boundaries, or write exactly \`Not Applicable.\` when genuinely inapplicable>

### Interfaces & types
\`\`\`typescript
// Shared props, state, events, query shapes, or accessibility contracts.
\`\`\`

### Reference snippets
\`\`\`tsx
// Canonical component imports, hook usage, keyboard wiring, or layout examples.
\`\`\`

## Requirements (acceptance criteria)
- <one concrete, verifiable requirement per bullet; include exact states, interactions, semantics, classes/tokens, and responsive behavior>
- Include UI, integration, and accessibility test coverage for the design's risk areas.
- Verify the implemented user-facing entry point end-to-end; unit tests alone are insufficient.

## What to avoid
- Do not implement code or edit files as the UI/UX engineer; this handoff is advisory only.
- Do not present alternative designs, generic advice, or requirements without concrete evidence and file-level consequences.
- Do not invent components, props, tokens, keyboard behavior, or source-of-truth locations when existing repository patterns apply.
- <explicit task-specific anti-patterns, scope boundaries, and destructive-action/source-of-truth pitfalls>

## Skills to activate
- <relevant repository skills and why they apply, or write exactly \`Not Applicable.\` when none apply>

## Out of scope
- <explicit files, flows, behavior, or migration work the implementer must not touch>

## Handoff
Run the normal handoff command to the configured entry point with this complete design, then stop.${placeholderInstruction}

\`\`\`bash
${handoffCommand({
  chatroomId: '<chatroom-id>',
  role: 'uiux-engineer',
  nextRole: entryPoint,
  cliEnvPrefix: '',
})}
\`\`\``;
}
