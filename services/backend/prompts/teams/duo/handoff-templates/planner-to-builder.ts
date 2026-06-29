/**
 * Handoff template: Duo planner → builder (delegation brief).
 *
 * Provides the structure the planner should follow when delegating an
 * implementation slice to the builder. The planner owns technical decisions
 * down to the file level, with code snippets that leave no ambiguity; the
 * builder executes implementation, tool calls, and verification.
 */

import { getHandoffRecipientVisibilityCallout } from '../../../native/handoff-visibility';

/**
 * Returns the markdown delegation-brief template the planner uses when
 * handing a unit of work to the builder.
 *
 * Every field is mandatory — when a section does not apply the planner writes
 * `Not Applicable` rather than omitting it, so the brief is never ambiguous.
 */
export function getPlannerToBuilderHandoffTemplate(nativeIntegration = false): string {
  const sessionManagement = nativeIntegration
    ? `\`compact\` runs in-session context compaction via the SDK runtime. \`new_session\` starts a completely new session within the same process (not compaction). \`none\` continues the prior session. Tasks continue via injection.`
    : `\`compact\` is NOT supported — use \`none\` or \`new_session\`. \`new_session\` requires a hard restart (daemon stops agent, cold-starts, agent rejoins via \`get-next-task\`). \`none\` resumes prior session (\`wantResume=true\`).`;

  return `${getHandoffRecipientVisibilityCallout('builder')}

**Delegation Brief (Planner → Builder)** — paste into the handoff message and fill in EVERY field. No field is optional: if a section does not apply, write \`Not Applicable\` (do not delete the section).

**Division of labor:** You (planner) own architecture and API shape. The builder implements exactly what you specify, runs verification, and does not redesign or invent alternatives unless blocked.

**Detail bar:** Specify down to **every file** the builder will create or modify (full repo paths). Include code snippets — types, signatures, stubs, or target implementations — until a competent builder **cannot misinterpret** what to write. Vague layers ("update the backend", "fix the component") are not acceptable.

\`\`\`markdown
## Summary
<brief context for this delegation slice — what problem it solves and where it fits in the larger task>

## Goal
<one sentence: the outcome this slice delivers>

## Key Knowledge for High Quality Bar
<details that would move the implementation from good to excellent and delightful — domain context, user expectations, edge cases, naming, UX polish, invariants the builder must preserve>

## Force Multipliers
<choices that greatly simplify the solution while preserving long-term maintainability — reuse existing abstractions, avoid unnecessary layers, leverage platform conventions>

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
- <e.g. chatroom skill activate code-review --chatroom-id=<id> --role=builder, or "Not Applicable">

## Out of scope
- <files or areas the builder must NOT touch in this slice, or "Not Applicable">

## Session Augmentation
Valid values: \`none\` | \`compact\` | \`new_session\`
- \`none\` — continue prior session context
- \`compact\` — run in-session context compaction (native SDK harnesses only)
- \`new_session\` — start a completely new session (default)
// data:agent.session_augmentation=new_session

${sessionManagement}

Keep one slice ≈ one focused review surface. Delegate slices incrementally — one at a time, not all at once.`;
}
