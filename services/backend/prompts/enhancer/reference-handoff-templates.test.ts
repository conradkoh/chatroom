import { describe, expect, it } from 'vitest';

import {
  renderEnhancerOutputTemplateContent,
  renderEnhancerReferencesXml,
} from './reference-handoff-templates';
import { getEnhancerToPlannerHandoffTemplate } from '../teams/duo/handoff-templates/enhancer-to-planner.js';

const FIXTURE_CHATROOM_ID = '000000000000010002chatroom_rooms';
const FIXTURE_CLI_ENV_PREFIX = 'CHATROOM_CONVEX_URL=http://127.0.0.1:3210 ';

describe('renderEnhancerOutputTemplateContent', () => {
  const baseParams = {
    teamId: 'duo',
    chatroomId: FIXTURE_CHATROOM_ID,
    outputTemplate: '## Summary\nEnhancer output template',
    cliEnvPrefix: FIXTURE_CLI_ENV_PREFIX,
    nativeIntegration: true,
  };

  it('contains planner output section and intro', () => {
    const result = renderEnhancerOutputTemplateContent(baseParams);

    expect(result).toContain('### Handoff to `planner` (your output)');
    expect(result).toContain('Enhancer output template');
    expect(result).toContain('<references>');
  });

  it('does NOT contain builder or user reference template bodies', () => {
    const result = renderEnhancerOutputTemplateContent(baseParams);

    expect(result).not.toContain('### Handoff to `builder`');
    expect(result).not.toContain('### Handoff to `user`');
    expect(result).not.toContain('Delegation Brief');
    expect(result).not.toContain('Report Template');
  });
});

describe('materialized enhancer handoff-templates block (spawn output contract)', () => {
  const outputTemplate = getEnhancerToPlannerHandoffTemplate();

  it('matches inline snapshot — full content enhancer sees in task envelope handoff-templates', () => {
    const result = renderEnhancerOutputTemplateContent({
      teamId: 'duo',
      chatroomId: FIXTURE_CHATROOM_ID,
      outputTemplate,
      cliEnvPrefix: FIXTURE_CLI_ENV_PREFIX,
      nativeIntegration: true,
    });
    expect(result).toMatchInlineSnapshot(`
      "Use these structures for this review. Your feedback must follow **Handoff to \`planner\`** (your output). Use \`<references>\` handoff templates to assess whether the planner builder draft aligns with final user delivery principles.

      ### Handoff to \`planner\` (your output)
      ---

      ⚠️ **CRITICAL — Recipient visibility**

      The \`planner\` agent **only** receives the text inside your \`handoff --next-role="planner"\` command.

      They **cannot** see:
      - Anything you write in this agent session
      - Progress reports
      - Tool output

      Put your **complete** deliverable in the handoff message — not in session text.

      ---

      **Planning Feedback (Enhancer → Planner)** — complete every section below. Do not omit sections, principles, or XML wrappers:

      When a section has no content, write exactly \`Not Applicable.\` — no explanation, no em-dash, no additional text.

      The planner sent you three XML sections. Your job is **advisory adversarial review** — raise risks, challenge assumptions, align with user intent. Keep most sections abstract.

      For **user interface changes**, run the UX review checklist in <ux-reference> and report findings under **Recommendations** (no code). Put file-level removals/changes with code snippets only in **Suggested edits** — always the last section. **Do not rewrite their full builder brief.** The planner makes the final call.

      \`\`\`markdown
      <handoff-overview>
      ## Summary
      <one paragraph: overall assessment — strengths, main risks, and whether the approach is sound>

      ## User intent alignment
      <does the planner's reading of the user request match what was asked? misreadings or missing constraints?>
      </handoff-overview>

      <!-- UI collapses proofs, direction, and notes by default; overview and action required are expanded -->

      <handoff-proofs>
      ## Reasoning review
      <logical errors, weak inference, contradictions — challenge assumptions>
      </handoff-proofs>

      <handoff-direction>
      ## Alignment with eventual user handoff
      <will this approach produce a credible planner→user report? what's missing for user-facing completeness?>
      </handoff-direction>

      <handoff-notes>
      ## Knowledge gaps
      <facts, context, or research the planner should verify — advisory questions, not answers from codebase>
      </handoff-notes>

      <handoff-action>
      ## Risks & failure modes
      <what could go wrong if they proceed as planned? common pitfalls for this kind of work?>

      ## Recommendations
      <!-- SECOND-LAST SECTION — abstract guidance only. No file paths, no code blocks. -->
      <!-- For UI changes: report UX checklist findings (write "Not Applicable." for non-UI tasks): -->
      - **Flows:** ...
      - **Patterns:** ... (include mobile vs desktop)
      - **Layout:** ...
      - **Shortcuts:** ...
      <!-- Include questions for the planner and other actionable recommendations here. -->

      ## Suggested edits (remove or change only)
      <!-- LAST SECTION — file-level detail and code examples only. Omit entirely if none. -->
      When you recommend removing or changing specific content in the planner's check-in, list each change here with file-level detail and code examples.
      <!-- File references (clickable in workspace UI): use repo-relative paths with a file extension — e.g. \`apps/webapp/src/modules/chatroom/foo.ts\` or [apps/webapp/src/foo.ts](apps/webapp/src/foo.ts). Avoid absolute paths, file:// prefixes, and paths without / or extension. -->

      ### <section or claim to remove or change>
      **File:** \`apps/webapp/src/path/to/file.ts\`
      **Change:** <what to remove, replace, or correct and why>

      \`\`\`typescript
      // Code snippet: what should change, be removed, or what the planner got wrong
      \`\`\`

      (Add one ### block per distinct removal or change. Use repo-relative paths with file extensions.)
      </handoff-action>
      \`\`\`

      Return only the feedback markdown — no preamble. Follow this structure; omit sections that truly do not apply.
      "
    `);
  });
});

describe('renderEnhancerReferencesXml', () => {
  const baseParams = {
    teamId: 'duo',
    chatroomId: FIXTURE_CHATROOM_ID,
    outputTemplate: '## Summary\nEnhancer output template',
    cliEnvPrefix: FIXTURE_CLI_ENV_PREFIX,
    nativeIntegration: true,
  };

  it('duo returns planner-to-builder and planner-to-user references', () => {
    const result = renderEnhancerReferencesXml(baseParams);

    expect(result).toContain('handoff-template for="planner->builder" team="duo"');
    expect(result).toContain('handoff-template for="planner->user" team="duo"');
    expect(result).toContain('Delegation Brief (Planner → Builder)');
    expect(result).toContain('Report Template (Planner → User)');
  });

  it('solo returns only solo-to-user reference', () => {
    const result = renderEnhancerReferencesXml({
      ...baseParams,
      teamId: 'solo',
    });

    expect(result).toContain('handoff-template for="solo->user" team="solo"');
    expect(result).not.toContain('planner->builder');
    expect(result).toContain('Report Template (Solo → User)');
  });
});
