import { getFileReferenceGuidanceComment } from '../utils/file-reference-guidance';
import { getDelegationBriefIntro } from '../utils/handoff-section-guidance';

export interface BuilderDelegationBriefOptions {
  /** Role writing the brief: 'planner' in the duo preset. */
  delegatorRole: string;
  /** 'self' when the delegator clears research/triage/architect gates itself (duo planner); otherwise the role that clears them. */
  gatesOwner: 'self' | string;
}

/** Returns the markdown delegation-brief template body. */
export function getBuilderDelegationBriefTemplate(options: BuilderDelegationBriefOptions): string {
  const { delegatorRole, gatesOwner } = options;

  const prelude =
    gatesOwner === 'self'
      ? `**Before you delegate:** if this slice introduces anything not yet grounded in the repository (a new library, API, external platform behavior, or an unresolved choice that depends on missing facts), hand off to \`researcher\` first and delegate only after its brief returns. Skip this when the \`researcher\` template's skip condition applies. The \`researcher\` handoff template defines the criteria.

**Bug fixes:** if this slice fixes a reported bug, delegate only after a \`triage\` report for that bug has returned, and build the brief from its root cause and proposed fix. The \`triage\` handoff template defines the investigation.

**Division of labor:** For backend contract, API, or schema/persistence changes, the architect designs first and you delegate only after its design returns. You (${delegatorRole}) own slicing and sequencing of builder work. The UI/UX engineer owns UI/UX design. Include its target markup, classes, styles, and screen and flow drawings in UI implementation briefs; the builder implements the components.`
      : `**Before you delegate:** the \`${gatesOwner}\` clears research, triage, architecture, UI/UX, and asset gates before work reaches you. If a slice depends on a fact, design decision, or bug diagnosis that the work package does not settle, hand back to \`${gatesOwner}\` with the open question instead of guessing. Do not hand off to \`researcher\`, \`triage\`, \`architect\`, or any other specialist yourself.

**Division of labor:** You (${delegatorRole}) own turning the work package into file-level builder slices and sequencing them. Copy any UI/UX target markup, classes, styles, and drawings from the work package into UI implementation briefs; the builder implements the components.`;

  return `${getDelegationBriefIntro()}

${prelude}

**Detail bar:** Specify down to **every file** the builder will create or modify (full repo paths). Include code snippets — types, signatures, stubs, or target implementations — until a competent builder **cannot misinterpret** what to write. Vague layers ("update the backend", "fix the component") are not acceptable.

**Test seams:** Fill \`## Test seams\` in the brief body for each behavior the slice changes. See the \`test-seam\` glossary term for what a seam is.

Guidance for you (not part of the message): Keep one slice ≈ one focused review surface. Delegate slices incrementally — one at a time, not all at once.

\`\`\`\`markdown
## Summary
<brief context for this delegation slice — what problem it solves and where it fits in the larger task>

## Goal
<one sentence: the outcome this slice delivers>

## Key Knowledge for High Quality Bar
<details that would move the implementation from good to excellent and delightful — domain context, user expectations, edge cases, naming, UX polish, invariants the builder must preserve>

## Force Multipliers
<choices that greatly simplify the solution while preserving long-term maintainability — reuse existing abstractions, avoid unnecessary layers, leverage platform conventions>
- Each builder delegation starts a fresh session automatically — the builder does not continue prior context.

## Files to implement (exhaustive, file-level)
List **every** file in this slice. Mark each file **(Required)** or **(Optional)** — all Required files must land before PR. For each file, state the exact change and paste the code the builder should match (no guessing).
${getFileReferenceGuidanceComment()}

### \`apps/webapp/src/path/to/file.ts\`
**Change:** <precisely what to add, modify, or remove in this file>

\`\`\`typescript
// Target code: exports, types, function bodies, component skeleton, query/mutation shape, etc.
// Enough that the builder can implement this file without inventing structure
\`\`\`

### \`apps/webapp/src/path/to/other-file.ts\`
**Change:** <...>

\`\`\`typescript
// ...
\`\`\`

(Add one ### block per file. If this slice touches only one file, still use the ### header.)

## Shared contracts (${delegatorRole}-owned)
Cross-file types, interfaces, or patterns that apply beyond a single file. Omit if everything is already specified per-file above.

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
- Include at least one check that the feature is **verified end-to-end**. Unit tests alone are insufficient for new features.

## Test seams
- <behavior>: seam <public interface or port>; catches <what>; misses <what>
- or: no test seam — <reason>
- For each named seam: write a failing test first, then make it pass (red-green). If the seam is \`no test seam\`, delete this line.

## What to avoid
- <anti-patterns, recurring mistakes, or scope creep for this slice — be explicit>
- Do not test private methods or mock internal collaborators. A test that breaks on refactor while behavior is unchanged is wrong.
- Do not derive expected values by re-running the code's own formula. Take them from a known-good literal, a worked example, or the spec.
- <e.g. "Do not add new abstractions", "Do not refactor unrelated files", "Do not change existing public APIs">

## Skills to activate
- e.g. \`chatroom skill activate code-review --chatroom-id=<id> --role=builder\`

## Out of scope
- <files or areas the builder must NOT touch in this slice>

\`\`\`\``;
}
