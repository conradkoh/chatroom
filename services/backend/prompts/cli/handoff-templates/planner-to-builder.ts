/**
 * Handoff template: Planner → Builder (delegation brief).
 *
 * Provides the structure the planner should follow when delegating an
 * implementation slice to the builder. This replaces the previous hard
 * requirement that a structured workflow MUST exist before any delegation —
 * a clear, self-contained brief is sufficient for most work. Structured
 * workflows remain available as an opt-in tool (activate the `workflow`
 * skill) for genuinely multi-phase, interdependent efforts.
 */

/**
 * Returns the markdown delegation-brief template the planner uses when
 * handing a unit of work to the builder.
 *
 * The template is intentionally compact: name the outcome, the concrete
 * artifacts, verifiable acceptance criteria, and what to leave alone. Every
 * field is mandatory — when a section does not apply the planner writes
 * `Not Applicable` rather than omitting it, so the brief is never ambiguous.
 */
export function getPlannerToBuilderHandoffTemplate(): string {
  return `**Delegation Brief (Planner → Builder)** — paste into the handoff message and fill in EVERY field. No field is optional: if a section does not apply, write \`Not Applicable\` (do not delete the section).

\`\`\`markdown
## Goal
<one sentence: the outcome this slice delivers>

## Scope & Files
- \`path/to/file.ts\` — <what to create/change> (use full paths when known)

## Requirements (acceptance criteria)
- <verifiable outcome the builder can self-check>
- Verify: \`pnpm typecheck && pnpm test\`

## Skills to activate
- <e.g. CHATROOM_CONVEX_URL=<endpoint> chatroom skill activate software-engineering --chatroom-id=<id> --role=builder, or "Not Applicable">

## Out of scope
- <what NOT to touch, or "Not Applicable">
\`\`\`

Keep one slice ≈ one focused review surface. Delegate slices incrementally — one at a time, not all at once.`;
}
