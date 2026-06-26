/**
 * Delegation guidelines section for the planner role.
 *
 * When a builder is available, guidance focuses on delegation discipline.
 * When the planner is implementing themselves, guidance focuses on
 * incremental self-implementation (the planner's implementer metarole).
 *
 * Delegation is template-driven by default: the planner hands a focused
 * slice to the builder using the Delegation Brief.
 */

import type { TeamCompositionConfig } from './team-composition';

type CmdHelper = (subcommand: string) => string;

function buildCmdHelper(cliEnvPrefix: string, chatroomIdArg: string, roleArg: string): CmdHelper {
  return (subcommand: string) =>
    `\`${cliEnvPrefix}chatroom ${subcommand} --chatroom-id=${chatroomIdArg} --role=${roleArg}\``;
}

function getDelegationBriefReference(nativeIntegration?: boolean): string {
  if (nativeIntegration) {
    return 'Use the **Handoff to `builder`** template in the task delivery `<handoff-templates>` section — follow that structure in your handoff message.';
  }
  return 'Use the **Handoff to `builder`** template in your task delivery next-steps — follow that structure in your handoff message.';
}

function getSoloImplementationGuidelines(cmd: CmdHelper, feedingNote: string): string {
  return `**Implementation Guidelines:**

Break complex features into small, focused slices. For architecture/SOLID guidance, activate the \`software-engineering\` skill: ${cmd('skill activate software-engineering')}.

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

Break complex features into small, focused slices, then delegate them to the builder one at a time. For architecture/SOLID guidance, activate the \`software-engineering\` skill: ${cmd('skill activate software-engineering')}.

**Decision flow:**
\`\`\`mermaid
flowchart TD
    A[Receive task] --> B{Can handle alone?}
    B -->|Yes: question, single fix| C[Handle yourself → deliver to user]
    B -->|No: needs builder| D[Write a Delegation Brief]
    D --> E[Hand off ONE slice to builder]
    E --> F[Review output]
    F -->|Not acceptable| G[Hand back with feedback]
    G --> E
    F -->|Acceptable| H{More slices?}
    H -->|Yes| E
    H -->|No| I[Deliver to user]
\`\`\`

**Default: delegate with a Delegation Brief.** ${delegationBriefRef}

**How to slice the work** — think about the phases a human engineer would actually go through to ship the work, then make each phase a slice. Some heuristics:

- **Each slice should name a concrete artifact** ("the X schema", "the Y entity", "the Z endpoint") — not a vague layer ("backend work", "implementation"). Weak builders fail when scope is unbounded.
- **File-level detail, zero ambiguity.** List every file (full paths) and paste snippets until the builder cannot guess wrong — not vague layers ("backend work", "the component").
- **You own technical design; the builder executes.** Per-file target code plus shared contracts in the brief — do not leave API shape for the builder to invent.
- **Spell out what to avoid** — anti-patterns and recurring mistakes you have seen from builders on similar work (scope creep, wrong abstractions, forbidden refactors).
- **One slice ≈ one focused review surface.** If you can't imagine reviewing it in one sitting, split it.
- **Order by dependency**, not by team convention. A slice should be runnable/testable when its dependencies are done.
- **Skip phases that don't apply** (e.g., no frontend for a backend-only change, no schema for a pure refactor).

**Code review:** For code-producing work, review before delivering. Activate the review framework with: ${cmd('skill activate code-review')}.

**Backlog items:** When the task originates from a backlog item, activate the backlog skill: ${cmd('skill activate backlog')}.

**If stuck:** After 2 failed rework attempts → step back, replan the slice, or deliver partial results with a clear explanation.

**Review loop:**
- Review completed work before moving to the next slice.
- Send back with specific feedback if requirements aren't met.
- ${feedingNote}.`;
}

/**
 * Generate the Delegation Guidelines section.
 */
// fallow-ignore-next-line complexity
export function getDelegationGuidelinesSection(
  config: Pick<TeamCompositionConfig, 'hasBuilder'>,
  options?: {
    cliEnvPrefix?: string;
    chatroomId?: string;
    role?: string;
    nativeIntegration?: boolean;
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

  return getBuilderDelegationGuidelines(
    cmd,
    feedingNote,
    getDelegationBriefReference(options?.nativeIntegration)
  );
}
