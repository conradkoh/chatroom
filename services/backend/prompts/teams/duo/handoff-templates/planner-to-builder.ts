/**
 * Handoff template: Duo planner → builder (delegation brief).
 *
 * Provides the structure the planner should follow when delegating an
 * implementation slice to the builder. The planner owns technical decisions
 * down to the file level, with code snippets that leave no ambiguity; the
 * builder executes implementation, tool calls, and verification.
 */

/**
 * Returns the markdown delegation-brief template the planner uses when
 * handing a unit of work to the builder.
 *
 * Every field is mandatory — when a section does not apply the planner writes
 * `Not Applicable` rather than omitting it, so the brief is never ambiguous.
 */
export function getPlannerToBuilderHandoffTemplate(nativeIntegration = false): string {
  const sessionManagement = nativeIntegration
    ? `**Native harnesses** (\`cursor-sdk\`, \`opencode-sdk\`): in-session context compaction is supported by the SDK runtime. \`new_session\` triggers a fresh context within the same process; the session stays active and tasks continue via injection.`
    : `**Native harnesses** (\`cursor-sdk\`, \`opencode-sdk\`): in-session context compaction is supported by the SDK runtime. \`new_session\` triggers a fresh context within the same process; no get-next-task rejoin needed.

**CLI harnesses** (all others): in-session compaction is NOT supported. \`new_session\` requires a hard restart — the daemon stops the agent, cold-starts it, and the agent must rejoin via \`get-next-task\`. \`none\` resumes the prior session (\`wantResume=true\`).`;

  return `**Delegation Brief (Planner → Builder)** — paste into the handoff message and fill in EVERY field. No field is optional: if a section does not apply, write \`Not Applicable\` (do not delete the section).

**Division of labor:** You (planner) own architecture and API shape. The builder implements exactly what you specify, runs verification, and does not redesign or invent alternatives unless blocked.

**Detail bar:** Specify down to **every file** the builder will create or modify (full repo paths). Include code snippets — types, signatures, stubs, or target implementations — until a competent builder **cannot misinterpret** what to write. Vague layers ("update the backend", "fix the component") are not acceptable.

\`\`\`markdown
## Goal
<one sentence: the outcome this slice delivers>

## Files to implement (exhaustive, file-level)
List **every** file in this slice. For each file, state the exact change and paste the code the builder should match (no guessing).

### \`path/to/file.ts\`
**Change:** <precisely what to add, modify, or remove in this file>

\`\`\`typescript
// Target code: exports, types, function bodies, component skeleton, query/mutation shape, etc.
// Enough that the builder can implement this file without inventing structure
\`\`\`

### \`path/to/other-file.ts\`
**Change:** <...>

\`\`\`typescript
// ...
\`\`\`

(Add one ### block per file. If this slice touches only one file, still use the ### header.)

## Shared contracts (planner-owned)
Cross-file types, interfaces, or patterns that apply beyond a single file. Write \`Not Applicable\` if everything is already specified per-file above.

### Interfaces & types
\`\`\`typescript
// Shared signatures, schemas, props, or DB shapes
\`\`\`

### Reference snippets
\`\`\`typescript
// Canonical call patterns, hook usage, imports, or wiring between files
\`\`\`

## Requirements (acceptance criteria)
- <verifiable outcome the builder can self-check>
- Verify: \`pnpm typecheck && pnpm test\`

## What to avoid
- <anti-patterns, recurring mistakes, or scope creep for this slice — be explicit>
- <e.g. "Do not add new abstractions", "Do not refactor unrelated files", "Do not change existing public APIs", or "Not Applicable">

## Skills to activate
- <e.g. chatroom skill activate software-engineering --chatroom-id=<id> --role=builder, or "Not Applicable">

## Out of scope
- <files or areas the builder must NOT touch in this slice, or "Not Applicable">

## Session Management
Valid values: \`new_session\` | \`none\`
- \`new_session\` — start a fresh agent session (default)
- \`none\` — continue prior session context
// data:agent.compress_context=new_session

${sessionManagement}

Keep one slice ≈ one focused review surface. Delegate slices incrementally — one at a time, not all at once.`;
}
