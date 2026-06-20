/**
 * Handoff template: Duo builder → planner (work complete / blocked).
 */

/**
 * Returns the markdown handoff template the builder uses when returning work
 * to the planner.
 */
export function getBuilderToPlannerHandoffTemplate(): string {
  return `**Handoff Template (Builder → Planner)** — paste into the handoff message. Fill in EVERY section; use \`Not Applicable\` when a section does not apply.

\`\`\`markdown
## Summary
<what was implemented or attempted, in plain terms>

## Proof — files changed
- \`path/to/file.ts\` — <what changed and why>

## Verification
- \`pnpm typecheck && pnpm test\` — <pass/fail + notes>

## Blockers / questions
<anything needing planner decision, or "Not Applicable">

## Notes for review
<specific areas for planner to check, or "Not Applicable">
\`\`\``;
}
