/**
 * Handoff template: Solo → user (final report).
 */

export function getSoloToUserReportTemplate(): string {
  return `**Report Template (Solo → User)** — the user can ONLY see this handoff message, so make it a complete, standalone document in markdown. Fill in EVERY section: if one does not apply, write \`Not Applicable\` (do not delete the section):

\`\`\`markdown
## Summary
<what was accomplished, in plain terms — no references to prior messages>

## Proof — files changed
- \`path/to/file.ts\` — <what changed and why>
<list every file you modified; this is the evidence of work>

## Key Technical Decisions
- <schema design, modules, interfaces, domain entities — what you chose and why, or "Not Applicable">

## Key Tradeoffs
- <what was weighed against what, and why you chose this path, or "Not Applicable">

## Tech Debt Observed
- <issues noticed but intentionally left out of scope of this change, or "Not Applicable">

## System Design
<include a mermaid diagram when the change has non-trivial structure; write "Not Applicable" for trivial changes>

\`\`\`mermaid
flowchart TD
    A[Component] --> B[Component]
\`\`\`

## Verification
- \`pnpm typecheck && pnpm test\` — <result>

## Notes / Next steps
<anything the user should know, follow-ups, or open questions, or "Not Applicable">
\`\`\``;
}
