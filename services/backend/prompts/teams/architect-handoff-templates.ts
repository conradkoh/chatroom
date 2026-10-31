import { handoffCommand } from '../cli/handoff/command';
import type { HandoffTemplateQuery } from '../cli/handoff-templates/contracts';
import { getFileReferenceGuidanceComment } from '../utils/file-reference-guidance';

function getArchitectFocus(): string {
  return 'module boundaries, APIs, schemas, indexes and queries, invariants, failure and recovery handling, tests, and implementation sequence';
}

function getArchitectRequirements(): string {
  return `
- Cite repository evidence for domain model/entity ownership, lifecycle, invariants, identifiers, and relationships.
- Define service and module boundaries, public and internal APIs, function signatures, and ownership of side effects.
- Analyze concurrency and races: concurrent writers, idempotency, ordering and monotonicity, retries, transactions, and failure/recovery behavior.
- Design read patterns first: primary read paths, indexes, projections/read models, query shapes, scan and transaction limits, and invalidation/subscription scope.
- Account for Convex reactivity and bandwidth: query invalidation patterns, avoiding unnecessary reactive fanout, and separating high-frequency heartbeat/liveness/status fields from low-frequency identity/configuration fields.
- Specify concrete schema, query, and mutation changes; migration/backfill sequence; tests; and verification order.
- Make every new or changed interface complete: list each method or field with its callers, its inputs and outputs, and the failure modes it must signal to those callers. An interface with an unnamed caller or an unspecified failure mode is incomplete.
- Apply the deletion test to every new module, class, or abstraction: name what complexity would reappear across its callers if it were deleted. A module that fails the test (its callers would be no more complex without it) must be removed from the design.`;
}

/** Body for the entry role delegating design work to the architect. */
export function getEntryPointToArchitectHandoffTemplate(query: HandoffTemplateQuery): string {
  const entryPoint = query.fromRole;

  return `The automatically injected \`<user-message>\` is the authoritative request. Add only concise context that the Architect needs to design within the existing repository and team scope.

Use this before any backend contract, API, or schema/persistence change.

Provide the request, relevant constraints, and the files or product surfaces that need inspection. Ask for one evidence-backed design focused on ${getArchitectFocus()}.

After completing the design, the \`architect\` must hand it back to \`${entryPoint}\` with the normal handoff command, then stop; it must not implement the design or delegate further work.

\`\`\`bash
${handoffCommand({
  chatroomId: '<chatroom-id>',
  role: 'architect',
  nextRole: entryPoint,
  cliEnvPrefix: '',
})}
\`\`\``;
}

/** Body for the architect returning one recommended design to the entry role. */
export function getArchitectToEntryPointHandoffTemplate(query: HandoffTemplateQuery): string {
  const entryPoint = query.toRole;
  const sharedContractsHeading = `## Shared contracts (${entryPoint}-owned)`;

  return `Instructions (not part of the message): Return exactly one recommended, evidence-backed design brief for the authoritative user request to \`${entryPoint}\`. This is an advisory handback: do not implement code, edit files, spawn subagents, present alternatives, or expand scope. The injected \`<handoff-templates>\` block is the authoritative structure for this handoff; complete every section in order. Use \`Not Applicable.\` only when a section is genuinely inapplicable, with no explanation or filler.

## Summary
<describe the design problem being solved, the repository/product surface where it fits, and the evidence-backed context; do not refer to hidden session text>

## Goal
<state the one-sentence outcome this design delivers>

## Key Knowledge for High Quality Bar
<cite the inspected repository patterns and complete the architect checklist below; do not provide a high-level essay>
- Produce exactly one recommended design for ${getArchitectFocus()}.
- Name concrete repository paths, existing abstractions, APIs/types, state/data flow, acceptance criteria, risks, and verification steps.
- Name every seam (a port, adapter, or injected dependency) the design introduces. Each seam must have a named consumer: a test that substitutes it, or a second real adapter. Do not introduce a seam with neither.
- Check \`memory/\` and \`docs/\` for prior decisions about the area being designed. Cite each relevant decision by path and state whether the design preserves it or overturns it, with the reason. Verify each path exists with \`ls\` before citing it.
${getArchitectRequirements()}

## Force Multipliers
<name the existing abstractions, patterns, utilities, and platform conventions to reuse, and state why each reduces implementation risk or duplication>
- Keep the design within the repository's established source-of-truth boundaries and avoid introducing a new registry or abstraction without evidence.

## Files to implement (exhaustive, file-level)
List every file or product surface the implementer must create or modify. Mark each \`(Required)\` or \`(Optional)\`. For every file, give the exact responsibility, exported types/signatures/query shape, state/data/event boundaries, and target code detailed enough to implement without guessing.
${getFileReferenceGuidanceComment()}

### \`<repo-relative/path.ext>\` (Required)
**Change:** <precise add/modify/remove responsibility and why>

\`\`\`text
// Target code, API/type signature, query shape, or migration/backfill step.
// Enough detail that implementation requires no invention.
\`\`\`

<add one block per file; do not collapse multiple files into a directory or vague layer>

${sharedContractsHeading}
<list cross-file interfaces, schemas, API contracts, state/data boundaries, or write exactly \`Not Applicable.\` when genuinely inapplicable>

### Interfaces & types
\`\`\`typescript
// Shared signatures, schemas, query/mutation shapes, or state contracts.
\`\`\`

### Reference snippets
\`\`\`typescript
// Canonical imports, call patterns, or data-flow examples.
\`\`\`

## Requirements (acceptance criteria)
- <one concrete, verifiable requirement per bullet; include exact data shape, API contract, migration result, and failure behavior>
- Include repository test coverage for domain, concurrency, read-pattern, migration, and recovery risk areas.
- Verify the implemented user-facing feature or task-delivery path end-to-end; unit tests alone are insufficient.

## What to avoid
- Do not implement code or edit files as the architect; this handoff is advisory only.
- Do not present alternative designs, generic advice, or requirements without concrete evidence and file-level consequences.
- Do not invent APIs, schema fields, query shapes, indexes, or source-of-truth locations when existing repository patterns apply.
- Do not add a seam, wrapper, or interface with a single implementation and no test that substitutes it; inline it instead.
- <explicit task-specific anti-patterns, scope boundaries, and migration/source-of-truth pitfalls>

## Skills to activate
- <relevant repository skills and why they apply, or write exactly \`Not Applicable.\` when none apply>

## Out of scope
- <explicit files, flows, behavior, or migration work the implementer must not touch>

Instructions after the body (not part of the message): run the normal handoff command to \`${entryPoint}\` with the complete body above, then stop.

\`\`\`bash
${handoffCommand({
  chatroomId: '<chatroom-id>',
  role: 'architect',
  nextRole: entryPoint,
  cliEnvPrefix: '',
})}
\`\`\``;
}
