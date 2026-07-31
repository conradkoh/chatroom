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

      The planner sent you three XML sections. Your job is **advisory adversarial review** — raise risks, challenge assumptions, align with user intent. Be **specific and targeted**: cite concrete claims, files, UX choices, and gaps from the check-in so the planner can improve the plan without re-synthesizing vague feedback.

      Give **concrete, actionable recommendations** in every section. End with **Recommendations** (second-last: summarized suggestions, tradeoffs, and considerations) then **Suggested edits** (last: proposed edits to grounding and the builder-handoff with file paths and code snippets). For UI work, run the UX checklist in <ux-reference> and report **specific** findings under **Recommendations**. **Do not rewrite their full builder brief.** The planner makes the final call.

      \`\`\`markdown
      <handoff-overview>
      ## Summary
      <overall assessment — cite specific strengths, risks, and whether the approach is sound; reference concrete elements from the check-in>

      ## User intent alignment
      <specific misreadings or missing constraints — what the user asked vs what the planner proposed>
      </handoff-overview>

      <!-- UI collapses proofs, direction, and notes by default; overview and action required are expanded -->

      <handoff-proofs>
      ## Reasoning review
      <specific logical errors, weak inference, or contradictions — cite the claim and why it fails>
      </handoff-proofs>

      <handoff-direction>
      ## Alignment with eventual user handoff
      <specific gaps for user-facing completeness — what proof or report sections would be missing>
      </handoff-direction>

      <handoff-notes>
      ## Knowledge gaps
      <specific facts, files, or research to verify — name what to check and why>
      </handoff-notes>

      <handoff-action>
      ## Risks & failure modes
      <specific risks tied to this plan — what fails, under what conditions, and how to mitigate>

      ## Recommendations
      <!-- SECOND-LAST — concrete, actionable suggestions tied to the check-in. Include tradeoffs and considerations. No code blocks here (use Suggested edits for snippets). -->
      <!-- For UI changes: report specific UX checklist findings (write "Not Applicable." for non-UI tasks): -->
      - **Flows:** ...
      - **Patterns:** ... (include mobile vs desktop)
      - **Layout:** ...
      - **Shortcuts:** ...

      ## Suggested edits (remove or change only)
      <!-- LAST — proposed edits to grounding and builder-handoff. File paths and code snippets required when recommending changes. Omit entirely if none. -->
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
