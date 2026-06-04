/**
 * Handoff template: Planner → User (final report).
 *
 * This is the most important template in the set: the planner is the single
 * point of contact for the user, and the user can ONLY see the final
 * handoff-to-user message. A high-quality report shapes the planner's goals
 * up-front, which is why this template is delivered eagerly with the user
 * message (see prompts/cli/get-next-task/fullOutput.ts) rather than requiring
 * the agent to fetch it on demand.
 *
 * Two parts are mandatory:
 *  1. Proof — the concrete list of files that were modified.
 *  2. System design — a mermaid diagram, when the change has non-trivial
 *     structure (skip for trivial one-line changes).
 */

/**
 * Returns the markdown report template the planner uses when delivering the
 * final result to the user.
 */
export function getPlannerToUserReportTemplate(): string {
  return `**Report Template (Planner → User)** — the user can ONLY see this handoff message, so make it a complete, standalone document in markdown:

\`\`\`markdown
## Summary
<what was accomplished, in plain terms — no references to prior messages>

## Proof — files changed
- \`path/to/file.ts\` — <what changed and why>
<list every file you (or the builder) modified; this is the evidence of work>

## System Design
<include a mermaid diagram when the change has non-trivial structure; omit only for trivial changes>

\`\`\`mermaid
flowchart TD
    A[Component] --> B[Component]
\`\`\`

## Verification
- \`pnpm typecheck && pnpm test\` — <result>

## Notes / Next steps
<anything the user should know, follow-ups, or open questions — optional>
\`\`\``;
}
