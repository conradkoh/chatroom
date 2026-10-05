/**
 * Delegation guidelines section for the planner role.
 *
 * Delegation is template-driven: the planner hands focused slices
 * to the builder using the Delegation Brief.
 */

import type { TeamCompositionConfig } from './team-composition';

type CmdHelper = (subcommand: string) => string;

function buildCmdHelper(cliEnvPrefix: string, chatroomIdArg: string, roleArg: string): CmdHelper {
  return (subcommand: string) =>
    `\`${cliEnvPrefix}chatroom ${subcommand} --chatroom-id=${chatroomIdArg} --role=${roleArg}\``;
}

function getDelegationBriefReference(): string {
  return 'Use the **Handoff to `builder`** template in the task delivery `<handoff-templates>` section — follow that structure in your handoff message.';
}

function getSoloImplementationGuidelines(cmd: CmdHelper, feedingNote: string): string {
  return `**Implementation Guidelines:**

Break complex features into small, focused slices. For code review guidance, activate the \`code-review\` skill: ${cmd('skill activate code-review')}.

**Mandatory UI/UX-directed workflow for UI fixes and interface design:** First state the observed problem, desired user outcome, affected surfaces, constraints, and existing evidence; do not prescribe replacement UI. Hand off to the UI/UX engineer before production implementation. Require existing source and rendered-DOM/style inspection plus one browser-rendered target with exact markup, classes/styles, states, interactions, and UI test contract. Carry the engineer's complete design unchanged into implementation. Write and run meaningful production UI tests from that contract before production edits, confirm the failure is design-relevant, implement, rerun to green, and compare the production DOM/styles with the target. Missing evidence or unresolved design choices go back to the engineer through the configured entry point; do not redesign or weaken tests yourself.

- Implement one slice at a time; each slice ≈ one focused review surface.
- Review your own work before moving on; re-validate after rework.
- ${feedingNote}.`;
}

function getBuilderDelegationGuidelines(
  cmd: CmdHelper,
  feedingNote: string,
  delegationBriefRef: string
): string {
  return `**Delegation Guidelines:**

Break features into small, focused slices, then delegate them to the builder one at a time. For code review guidance, activate the \`code-review\` skill: ${cmd('skill activate code-review')}.

**Delegation rule:** If the task requires **any code changes** (new files, edits, deletions), you **must delegate to the builder** — regardless of how small the change is.

**Decision flow:**
\`\`\`mermaid
flowchart TD
    A[Receive task] --> B{Code changes needed?}
    B -->|Yes — any size| C{UI fix or interface design?}
    C -->|Yes| U[State problem; hand off to UI/UX engineer]
    U --> V[Review rendered design and test contract]
    V -->|Incomplete| U
    V -->|Complete| D[Write a Delegation Brief with design unchanged]
    C -->|No| D
    D --> E[Hand off ONE slice to builder]
    E --> F[Review output]
    F -->|Not acceptable| G[Hand back with feedback]
    G --> E
    F -->|Acceptable| H{More slices?}
    H -->|Yes| E
    H -->|No| I[Deliver to user]
    B -->|No: question or clarification only| X[Answer directly → deliver to user]
\`\`\`

**Default: delegate with a Delegation Brief.** ${delegationBriefRef}

**How to slice the work** — think about the phases a human engineer would actually go through to ship the work, then make each phase a slice. Some heuristics:

- **Each slice should name a concrete artifact** ("the X schema", "the Y entity", "the Z endpoint") — not a vague layer ("backend work", "implementation"). Weak builders fail when scope is unbounded.
- **File-level detail, zero ambiguity.** List every file (full paths) and paste snippets until the builder cannot guess wrong — not vague layers ("backend work", "the component").
- **The planner owns architecture and data/API design; the UI/UX engineer owns UI design and its test contract.** For UI work, preserve the engineer's DOM/style/test requirements unchanged in the builder brief; do not substitute your own.
- **Spell out what to avoid** — anti-patterns and recurring mistakes you have seen from builders on similar work (scope creep, wrong abstractions, forbidden refactors).
- **One slice ≈ one focused review surface.** If you can't imagine reviewing it in one sitting, split it.
- **Order by dependency**, not by team convention. A slice should be runnable/testable when its dependencies are done.
- **A slice is shippable only when verified end-to-end** — infra/helper files alone are not a complete slice.
- **Skip phases that don't apply** (e.g., no frontend for a backend-only change, no schema for a pure refactor).

**UI implementation gate:** The UI/UX engineer owns markup, classes/styles, states, interactions, responsive behavior, and the UI test contract. The entry point states the problem/outcome/surfaces and coordinates the engineer handoff, then forwards the engineer's complete handback unchanged. The builder writes and runs meaningful UI tests before production edits, then implements and compares the rendered result. Missing or changed design requirements must return to the engineer through the entry point. This gate applies to both builder delegation and solo implementation; non-UI delegation is unchanged.

**Code review:** For code-producing work, review before delivering. Activate the review framework with: ${cmd('skill activate code-review')}.

**Backlog items:** When the task originates from a backlog item, activate the backlog skill: ${cmd('skill activate backlog')}.

**Large or multi-surface revisions:** When refactoring, consolidating, or migrating many call sites, activate the defragmentation skill: ${cmd('skill activate defragmentation')}.

**If stuck:** After 2 failed rework attempts → replan or hand back to planner as blocked. No partial PR, \`mark-for-review\`, or user delivery.

**Review loop:**
- Review completed work before moving to the next slice.
- Send back with specific feedback if requirements aren't met.
- ${feedingNote}.

}`;
}

/**
 * Generate the Delegation Guidelines section.
 */
// fallow-ignore-next-line complexity
export function getDelegationGuidelinesSection(
  config: Pick<TeamCompositionConfig, 'hasBuilder'>,
  options?: {
    cliEnvPrefix?: string | undefined;
    chatroomId?: string | undefined;
    role?: string | undefined;
  }
): string {
  const feedingNote = config.hasBuilder
    ? 'Feed slices to the builder incrementally — one at a time, not all at once'
    : 'When implementing yourself, tackle one layer at a time — avoid large monolithic changes';

  const cliEnvPrefix = options?.cliEnvPrefix ?? '';
  const chatroomIdArg = options?.chatroomId ? `"${options.chatroomId}"` : '<id>';
  const roleArg = options?.role ? `"${options.role}"` : '<role>';
  const cmd = buildCmdHelper(cliEnvPrefix, chatroomIdArg, roleArg);

  if (!config.hasBuilder) {
    return getSoloImplementationGuidelines(cmd, feedingNote);
  }

  return getBuilderDelegationGuidelines(cmd, feedingNote, getDelegationBriefReference());
}
