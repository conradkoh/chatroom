/**
 * Handoff template: Squad reviewer → user (approval report).
 *
 * Squad reviewers normally hand off to the planner; this template exists for
 * teams or flows where direct user delivery is enabled.
 */

export function getReviewerToUserReportTemplate(): string {
  return `**Approval Report (Reviewer → User)** — the user can ONLY see this handoff message, so make it a complete, standalone document in markdown. Fill in EVERY section: if one does not apply, write \`Not Applicable\` (do not delete the section):

\`\`\`markdown
## Summary
<what was reviewed and the approval outcome — no references to prior messages>

## Proof — files reviewed
- \`path/to/file.ts\` — <what was checked>

## Key Technical Decisions
- <notable design choices validated during review, or "Not Applicable">

## Key Tradeoffs
- <tradeoffs assessed during review, or "Not Applicable">

## Tech Debt Observed
- <issues noticed but accepted for this release, or "Not Applicable">

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
