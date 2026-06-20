/**
 * Handoff template: Squad builder → reviewer (implementation ready for review).
 */

export function getBuilderToReviewerHandoffTemplate(): string {
  return `**Handoff Template (Builder → Reviewer)** — paste into the handoff message. Fill in EVERY section; use \`Not Applicable\` when a section does not apply.

\`\`\`markdown
## Summary
<what was implemented and why it is ready for review>

## Proof — files changed
- \`path/to/file.ts\` — <what changed and why>

## Verification
- \`pnpm typecheck && pnpm test\` — <pass/fail + notes>

## Review focus
<specific areas the reviewer should scrutinize, or "Not Applicable">

## Known limitations / open questions
<anything the reviewer should weigh, or "Not Applicable">
\`\`\``;
}
