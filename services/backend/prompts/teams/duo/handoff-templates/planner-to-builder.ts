/**
 * Handoff template: Duo planner → builder (delegation brief).
 *
 * Provides the structure the planner should follow when delegating an
 * implementation slice to the builder. The planner owns architecture/data/API
 * decisions down to the file level; the UI/UX engineer owns UI design and its
 * UI test contract. The builder executes implementation and verification.
 * Fields that do not apply may be omitted.
 */

import { getHandoffRecipientVisibilityCallout } from '../../../native/handoff-visibility';
import { getFileReferenceGuidanceComment } from '../../../utils/file-reference-guidance';
import { getDelegationBriefIntro } from '../../../utils/handoff-section-guidance';

/**
 * Returns the markdown delegation-brief template the planner uses when
 * handing a unit of work to the builder.
 *
 * Fields that do not apply may be omitted.
 */
export function getPlannerToBuilderHandoffTemplate(): string {
  return `${getHandoffRecipientVisibilityCallout('builder')}

${getDelegationBriefIntro()}

**Division of labor:** You (planner) own architecture and data/API shape. The UI/UX engineer owns UI structure, classes/styles, states, interactions, responsive behavior, and the UI test contract. The builder implements the specified design and does not redesign or invent alternatives unless blocked.

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

## UI/UX design contract
<For UI fix/interface work, paste the complete UI/UX engineer handback verbatim, including existing source/rendered DOM/style evidence, browser-rendered target HTML with class attributes and style dependencies, states/viewports, preview location and actual screenshot or DOM/computed-style evidence, and exact tests-first contract. The builder is a fresh session; a message link or summary is insufficient. For non-UI work, omit this section.>

**UI implementation sequence and acceptance gates (mandatory for UI work):**
1. The engineer design above is complete and unchanged; otherwise stop and return concrete missing evidence to planner.
2. Write and run the specified production UI tests before production edits. Record a meaningful design-relevant initial failure, not setup/environment failure.
3. Implement the design, rerun the same tests to pass, and compare production DOM/styles against the rendered target. Do not test only a mock of the proposed HTML.
4. If implementation requires a design or test-contract deviation, stop and request an engineer revision through planner. Planner must not substitute DOM/style/test requirements.

## Shared contracts (planner-owned)
Cross-file architecture, data, and API types or patterns that apply beyond a single file. UI design and UI test authority remain with the UI/UX engineer. Omit if everything is already specified per-file above.

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

## What to avoid
- <anti-patterns, recurring mistakes, or scope creep for this slice — be explicit>
- <e.g. "Do not add new abstractions", "Do not refactor unrelated files", "Do not change existing public APIs">

## Skills to activate
- <e.g. chatroom skill activate code-review --chatroom-id=<id> --role=builder>

## Out of scope
- <files or areas the builder must NOT touch in this slice>

Keep one slice ≈ one focused review surface. Delegate slices incrementally — one at a time, not all at once.`;
}
