/**
 * Handoff template: Squad reviewer → builder (rework feedback).
 */

export function getReviewerToBuilderHandoffTemplate(): string {
  return `**Rework Feedback (Reviewer → Builder)** — paste into the handoff message. Fill in EVERY section; use \`Not Applicable\` when a section does not apply.

\`\`\`markdown
## Summary
<overall assessment — what must change before approval>

## Issues found
- <specific problem> — <file/line or area> — <why it matters> — <suggested fix>

## Required changes
- <concrete change the builder must make>

## Verification after rework
- \`pnpm typecheck && pnpm test\` — <expected result>

## Notes
<anything else the builder should know, or "Not Applicable">
\`\`\``;
}
