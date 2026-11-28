import { getFileReferenceGuidanceComment } from '../utils/file-reference-guidance';
import { getDelegationBriefIntro } from '../utils/handoff-section-guidance';
import { VERIFICATION_KINDS, type VerificationKind } from '../utils/verification-kinds';

export interface BuilderDelegationBriefOptions {
  /** Role writing the brief: 'planner' in the duo preset. */
  delegatorRole: string;
  /** 'self' when the delegator clears research/triage/architect gates itself (duo planner); otherwise the role that clears them. */
  gatesOwner: 'self' | string;
  /**
   * Single-pass variant (trio specifier): the brief is the work package's only
   * builder pass, so it has one `full` verification scope and no scope choice.
   * Duo leaves this unset: it delegates incremental slices, so it offers
   * `focused | round-final`. Default false keeps duo output byte-identical.
   */
  singlePass?: boolean;
}

interface BriefVariantFragments {
  roundGuidance: string;
  verificationFlagsSection: string;
  /** Who owns the brief: one complete brief (single pass) or sliced sequencing. */
  divisionOfLabor: string;
}

function getVerificationKindFlagLine(kind: VerificationKind): string {
  const choice = kind.lightweight
    ? '**required**. Lightweight: the builder always runs it, so never mark it `not applicable`.'
    : '**required** or **not applicable: <reason>**.';
  const note = kind.note ? ` ${kind.note}` : '';
  return `- \`${kind.label}\` — ${choice} Command: \`${kind.command}\`${note}`;
}

const PLACEHOLDER_PROSE_LINE =
  "`<workspace>` and `<package>` are placeholders: replace them with the project's own directory and package name, and replace every other `<…>` in a command with the project's own command, flag, or file list.";

/** Shared tail of the full-scope definition; differs only in the scope label. */
const FULL_SCOPE_BODY =
  'each run covers the full scope: the full unit suite and full integration suite of every workspace this brief changed, typecheck and lint of those workspaces (lint across the whole repository), and every e2e spec this brief affects.';

function getScopeLines(singlePass: boolean): string[] {
  if (singlePass) {
    return [`Scope: \`full\` — ${FULL_SCOPE_BODY}`];
  }
  const focused =
    "`focused` — each run covers only the test files and workspaces that touch this brief's files.";
  return [
    "Scope: <`focused` | `round-final`> — replace the placeholder with this brief's scope and keep only that definition below.",
    `- ${focused}`,
    `- \`round-final\` — ${FULL_SCOPE_BODY}`,
  ];
}

function getVerificationFlagsSection(singlePass: boolean): string {
  return [
    '## Verification flags',
    'Mark each kind `required` or `not applicable: <reason>`. The builder runs every `required` kind with the command shown, always runs typecheck and lint, and records each `not applicable` kind in its hand-back.',
    ...getScopeLines(singlePass),
    ...VERIFICATION_KINDS.map(getVerificationKindFlagLine),
    PLACEHOLDER_PROSE_LINE,
    '',
    '',
  ].join('\n');
}

/**
 * Fragments that differ between the default incremental brief and the trio
 * single-pass brief. Kept out of the template function so the two paths stay
 * easy to read and the rendering function stays simple.
 */
function getBriefVariantFragments(
  singlePass: boolean,
  delegatorRole: string
): BriefVariantFragments {
  const roundGuidance = singlePass
    ? "This is the work package's only builder brief — the specifier makes one builder pass and cannot send rework. Cover the whole package: order the ### file blocks by dependency, and set the `## Verification flags` scope to `full`."
    : 'Keep one slice ≈ one focused review surface. Delegate slices incrementally — one at a time, not all at once. In the brief body, set the `## Verification flags` scope to `focused` for each slice and to `round-final` for the final slice, which runs the full pass once.';

  /** Trio's single pass has one complete brief; the default incremental path keeps slicing/sequencing. */
  const divisionOfLabor = singlePass
    ? `**Division of labor:** You (${delegatorRole}) own turning the work package into one complete file-level builder brief.`
    : `**Division of labor:** You (${delegatorRole}) own turning the work package into file-level builder slices and sequencing them.`;

  return {
    roundGuidance,
    verificationFlagsSection: getVerificationFlagsSection(singlePass),
    divisionOfLabor,
  };
}

/** Returns the markdown delegation-brief template body. */
export function getBuilderDelegationBriefTemplate(options: BuilderDelegationBriefOptions): string {
  const { delegatorRole, gatesOwner, singlePass = false } = options;

  /** Trio's single pass must not imply multiple slices; duo keeps "slice". */
  const unit = singlePass ? 'work package' : 'slice';

  const { roundGuidance, verificationFlagsSection, divisionOfLabor } = getBriefVariantFragments(
    singlePass,
    delegatorRole
  );

  const prelude =
    gatesOwner === 'self'
      ? `**Before you delegate:** if this slice introduces anything not yet grounded in the repository (a new library, API, external platform behavior, or an unresolved choice that depends on missing facts), hand off to \`researcher\` first and delegate only after its brief returns. Skip this when the \`researcher\` template's skip condition applies. The \`researcher\` handoff template defines the criteria.

**Bug fixes:** if this slice fixes a reported bug, delegate only after a \`triage\` report for that bug has returned, and build the brief from its root cause and proposed fix. The \`triage\` handoff template defines the investigation.

**Division of labor:** For backend contract, API, or schema/persistence changes, the architect designs first and you delegate only after its design returns. You (${delegatorRole}) own slicing and sequencing of builder work. The UI/UX engineer owns UI/UX design. Include its target markup, classes, styles, and screen and flow drawings in UI implementation briefs; the builder implements the components.`
      : `**Before you delegate:** the \`${gatesOwner}\` clears research, triage, architecture, UI/UX, and asset gates before work reaches you. If ${singlePass ? 'the work package' : 'a slice'} depends on a fact, design decision, or bug diagnosis that the work package does not settle, hand back to \`${gatesOwner}\` with the open question instead of guessing. Do not hand off to \`researcher\`, \`triage\`, \`architect\`, or any other specialist yourself.

${divisionOfLabor} Copy any UI/UX target markup, classes, styles, and drawings from the work package into UI implementation briefs; the builder implements the components.`;

  return `${getDelegationBriefIntro()}

${prelude}

**Detail bar:** Specify down to **every file** the builder will create or modify (full repo paths). Include code snippets — types, signatures, stubs, or target implementations — until a competent builder **cannot misinterpret** what to write. Vague layers ("update the backend", "fix the component") are not acceptable.

**Test seams:** Fill \`## Test seams\` in the brief body for each behavior the ${unit} changes. See the \`test-seam\` glossary term for what a seam is.

Guidance for you (not part of the message): ${roundGuidance}

\`\`\`\`markdown
## Summary
<brief context for this delegation ${unit} — what problem it solves and where it fits in the larger task>

## Goal
<one sentence: the outcome this ${unit} delivers>

## Key Knowledge for High Quality Bar
<details that would move the implementation from good to excellent and delightful — domain context, user expectations, edge cases, naming, UX polish, invariants the builder must preserve>

## Force Multipliers
<choices that greatly simplify the solution while preserving long-term maintainability — reuse existing abstractions, avoid unnecessary layers, leverage platform conventions>
- Each builder delegation starts a fresh session automatically — the builder does not continue prior context.

## Files to implement (exhaustive, file-level)
List **every** file in this ${unit}. Mark each file **(Required)** or **(Optional)** — all Required files must land before PR. For each file, state the exact change and paste the code the builder should match (no guessing).
${getFileReferenceGuidanceComment()}

### \`src/path/to/file.ts\`
**Change:** <precisely what to add, modify, or remove in this file>

\`\`\`typescript
// Target code: exports, types, function bodies, component skeleton, query/mutation shape, etc.
// Enough that the builder can implement this file without inventing structure
\`\`\`

### \`src/path/to/other-file.ts\`
**Change:** <...>

\`\`\`typescript
// ...
\`\`\`

(Add one ### block per file. If this ${unit} touches only one file, still use the ### header.)

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
- Name at least one end-to-end evidence that the feature works: a CLI run, an API call, a UI action, or the template render. Unit tests alone are insufficient for new features. When the brief marks \`e2e\` \`not applicable\`, the Requirements must name which of these alternatives is the end-to-end evidence.

## Test seams
- <behavior>: seam <public interface or port>; catches <what>; misses <what>
- or: no test seam — <reason>
- For each named seam: write a failing test first, then make it pass (red-green). If the seam is \`no test seam\`, delete this line.

${verificationFlagsSection}## What to avoid
- <anti-patterns, recurring mistakes, or scope creep for this ${unit} — be explicit>
- Do not test private methods or mock internal collaborators. A test that breaks on refactor while behavior is unchanged is wrong.
- Do not derive expected values by re-running the code's own formula. Take them from a known-good literal, a worked example, or the spec.
- <e.g. "Do not add new abstractions", "Do not refactor unrelated files", "Do not change existing public APIs">

## Skills to activate
- e.g. \`chatroom skill activate code-review --chatroom-id=<id> --role=builder\`

## Out of scope
- <files or areas the builder must NOT touch in this ${unit}>

\`\`\`\``;
}
