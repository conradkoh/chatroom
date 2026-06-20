/**
 * Handoff template: Squad reviewer → planner (review outcome).
 */

export function getReviewerToPlannerHandoffTemplate(): string {
  return `**Review Outcome (Reviewer → Planner)** — paste into the handoff message. Fill in EVERY section; use \`Not Applicable\` when a section does not apply.

\`\`\`markdown
## Outcome
<APPROVED ✅ | CHANGES REQUESTED — brief statement>

## Summary
<what was reviewed and the conclusion>

## Proof — files reviewed
- \`path/to/file.ts\` — <what was checked>

## Verification
- \`pnpm typecheck && pnpm test\` — <result observed or trusted from builder>

## Issues / follow-ups
<remaining concerns for planner, or "Not Applicable">

## Recommendation
<deliver to user | send back to builder for rework | partial delivery with explanation>
\`\`\``;
}
