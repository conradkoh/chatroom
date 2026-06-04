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
 * artifacts, verifiable acceptance criteria, and what to leave alone.
 */
export function getPlannerToBuilderHandoffTemplate(): string {
  return `**Delegation Brief (Planner → Builder)** — paste into the handoff message and fill in:

\`\`\`markdown
## Goal
<one sentence: the outcome this slice delivers>

## Scope & Files
- \`path/to/file.ts\` — <what to create/change> (use full paths when known)

## Requirements (acceptance criteria)
- <verifiable outcome the builder can self-check>
- Verify: \`pnpm typecheck && pnpm test\`

## Skills to activate (optional)
- <e.g. CHATROOM_CONVEX_URL=<endpoint> chatroom skill activate software-engineering --chatroom-id=<id> --role=builder>

## Out of scope
- <what NOT to touch>
\`\`\`

Keep one slice ≈ one focused review surface. Delegate slices incrementally — one at a time, not all at once.`;
}
