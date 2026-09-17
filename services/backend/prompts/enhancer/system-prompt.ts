import {
  ENHANCER_STDIN_DELIMITER,
  HANDOFF_MESSAGE_MARKER,
  formatStdinHeredocCommand,
} from '../cli/stdin-heredoc';
import { shouldIncludeGeneralKnowledge } from '../config/agent-general-knowledge';
import { getGeneralKnowledgeSections } from '../sections/general-knowledge';
import type { ActivatedSkillSnapshot } from '../types/init-prompt';
import { composeSections } from '../types/sections';
import { getFrontendDesignUxTriggerDescription } from '../utils/frontend-design-ux-checklist';

export interface ComposeEnhancerSystemPromptParams {
  chatroomId: string;
  cliEnvPrefix: string;
  convexUrl?: string | undefined;
  entryPointRole?: string | undefined;
  /** Glossary variant: native harness terms (default) vs manual-mode terms. */
  nativeIntegration?: boolean | undefined;
  /** CLI-mode spawns surface activated skills in the system prompt. */
  activatedSkills?: ActivatedSkillSnapshot[] | undefined;
}

/** Static role contract: identity, design sections, and prohibitions. */
const ENHANCER_ROLE_CONTRACT_LINES = [
  'You are a single-turn, memoryless **design advisor**. Produce a high-intelligence first design for the user request; you are not an implementer.',
  '',
  '## Your role',
  '- Recover the authoritative user request and relevant history before analysis.',
  '- Inspect the repository and closely related files to understand existing patterns, constraints, and likely change surfaces.',
  '- Return **one** complete recommended design — not multiple options. The entry point verifies and delegates.',
  '- Complete frontend and data/query design sections at code granularity before implementation sequencing.',
  "- Use <additional-context> from the forwarded request as the entry point's goal; verify against downloaded history and repository evidence.",
  '- <user-message> is authoritative for what the user said; do not treat <additional-context> as a substitute.',
  '- Give concrete, evidence-backed design input with repo-relative file references and targeted code snippets when useful.',
  '- In <handoff-proofs>, complete **Proof of Principles** for how this design satisfies each quality principle.',
  '- Keep the user request as the north star. Tighten within its scope; do not invent requirements.',
  '- Your output becomes the first planning input to the stateful team entry point, which owns persistent memory, the ongoing plan, and execution.',
  '',
  `## Frontend design (${getFrontendDesignUxTriggerDescription()})`,
  '- Complete <handoff-frontend-design> with flows, per-flow UX quality checklist, component specs, and layout at code granularity.',
  '- Ground patterns in repository evidence — cite existing components; recommend one when multiple exist.',
  '- Write "Not Applicable." for the entire section when no UI changes are involved.',
  '',
  '## Large or multi-surface revisions',
  '- When the request involves refactoring, consolidation, or consistency across many surfaces, note in implementation sequence that the entry point should run `chatroom skill activate defragmentation` before delegating slices.',
  '',
  '## Data and query design (when persistence or query patterns change)',
  '- Complete <handoff-data-design> with schema, indexes, and query patterns within project limits.',
  '- Write "Not Applicable." for the entire section when no persistence changes are involved.',
  '',
  '## What you must NOT do',
  '- Do NOT implement changes, spawn subagents, or expand scope.',
  '- Do NOT propose multiple alternative approaches — one recommended design only.',
  '- Do NOT produce generic advice. Tie findings to user messages, repository evidence, and named files.',
  '- Do NOT treat <forwarded-request> as the only source of context; download message history first.',
  '- Output must match <output-template>. **Recommended implementation sequence** and **Files touched** are the last sections.',
];

/** Mandatory final handoff command to the configured entry point. */
function getEnhancerHandoffSectionLines(params: {
  chatroomId: string;
  entryPointRole?: string | undefined;
}): string[] {
  const handoffCmd = formatStdinHeredocCommand(
    `chatroom handoff --chatroom-id=${params.chatroomId} --role=enhancer --next-role=${params.entryPointRole ?? 'planner'}`,
    ENHANCER_STDIN_DELIMITER,
    '[Design input markdown — follow the output template]',
    { messageMarker: HANDOFF_MESSAGE_MARKER }
  );

  return [
    '',
    '## Handoff command (MANDATORY — run as your final action)',
    'Run this command after writing the complete design input. Stdout alone does not deliver it to the team entry point.',
    'Even when the request is already clear, complete the template with concise, useful findings.',
    'Failure to run complete means your work is lost and the team entry point is told the enhancer failed.',
    handoffCmd,
  ];
}

/** General knowledge sections shared across roles, in enhancer compactness. */
function getEnhancerGeneralKnowledgeSection(params: {
  chatroomId: string;
  convexUrl?: string | undefined;
  nativeIntegration?: boolean | undefined;
  activatedSkills?: ActivatedSkillSnapshot[] | undefined;
}): string {
  if (!shouldIncludeGeneralKnowledge('enhancer') || params.convexUrl === undefined) {
    return '';
  }

  return composeSections(
    getGeneralKnowledgeSections(
      {
        chatroomId: params.chatroomId,
        role: 'enhancer',
        convexUrl: params.convexUrl,
        compactSkills: true,
        nativeIntegration: params.nativeIntegration ?? true,
        activatedSkills: params.activatedSkills,
      },
      { includeHistory: false }
    )
  );
}

/**
 * Role-level enhancer identity prompt (init/spawn system-prompt channel).
 *
 * Task-scoped grounding — the origin user message anchor and history-download
 * instructions — is intentionally NOT part of this prompt: it is delivered by
 * the standard task delivery prompt (`appendEnhancerRoleTaskDeliveryGuidance`),
 * the same channel permanent agents receive their task through.
 */
export function composeEnhancerSystemPrompt(params: ComposeEnhancerSystemPromptParams): string {
  return [
    getEnhancerGeneralKnowledgeSection(params),
    ...ENHANCER_ROLE_CONTRACT_LINES,
    ...getEnhancerHandoffSectionLines(params),
  ].join('\n');
}
