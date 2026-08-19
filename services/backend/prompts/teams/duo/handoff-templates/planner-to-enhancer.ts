/** Handoff template: Duo planner → enhancer (request-first advisory pass). */

/**
 * The planner forwards only the request. The enhancer recovers authoritative
 * history from the origin message ID attached to its job.
 */
export function getPlannerToEnhancerHandoffTemplate(): string {
  return `**Request Forward (Planner → Enhancer)** — copy the user's request below, without adding a plan, research, or a builder draft.

\`\`\`markdown
<request>
<the user's request, verbatim when practical>
</request>
\`\`\`

After handoff succeeds, **end your turn immediately**. The enhancer independently downloads the originating message history and returns planning input as your next planner task.`;
}
