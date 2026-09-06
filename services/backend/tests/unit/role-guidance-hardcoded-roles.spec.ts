/**
 * REGRESSION GUARD: Conditional role references in planner guidance.
 *
 * Ensures that the planner prompt uses metarole-aware language:
 * - When builder is absent, the prompt describes WHAT FUNCTION the planner fills.
 * - Handoff Rules, Delegation Guidelines, and Core Responsibilities are
 *   conditional on team composition.
 */

import { describe, expect, test } from 'vitest';

import { getBuilderGuidance } from '../../prompts/cli/roles/builder';
import { getEnhancerGuidance } from '../../prompts/cli/roles/enhancer';
import { getPlannerGuidance } from '../../prompts/cli/roles/planner';
import { buildSelectorContext, getRoleGuidanceFromContext } from '../../prompts/selector-context';

const CONVEX_URL = 'http://127.0.0.1:3210';

describe('getPlannerGuidance - Handoff Rules should be conditional on team members', () => {
  test('duo team planner should have builder delegation handoff rules', () => {
    const guidance = getPlannerGuidance({
      role: 'planner',
      teamRoles: ['planner', 'builder'],
      isEntryPoint: true,
      convexUrl: CONVEX_URL,
    });

    expect(guidance).toContain('Operating model: Planner + Builder');
    expect(guidance).toContain('**To delegate implementation** → Hand off to `builder`');
    expect(guidance).not.toContain('reviewer');
  });

  test('duo team planner - Handoff Rules snapshot', () => {
    const guidance = getPlannerGuidance({
      role: 'planner',
      teamRoles: ['planner', 'builder'],
      isEntryPoint: true,
      convexUrl: CONVEX_URL,
    });

    const handoffRulesMatch = guidance.match(
      /\*\*Handoff Rules:\*\*[\s\S]*?(?=\n\n\*\*|\n## |\n$)/
    );
    const handoffRulesSection = handoffRulesMatch ? handoffRulesMatch[0] : '(not found)';

    expect(handoffRulesSection).toMatchInlineSnapshot(`
      "**Handoff Rules:**

      ⚠️ After ANY handoff (including to \`user\`), you must run \`get-next-task\` to stay in the session.

      - **To delegate implementation** → Hand off to \`builder\` with clear requirements
      - **For rework** → Hand off back to \`builder\` with specific feedback on what needs to change
      - **To deliver to user** → Hand off to \`user\` with a complete, standalone summary
        ⚠️ The user can ONLY see the handoff-to-user message — progress reports and all other messages are invisible to them. Write the handoff as a self-contained document: include all relevant context, results, and next steps without assuming the user read any prior conversation."
    `);
  });

  test('solo planner should have simplified Handoff Rules', () => {
    const guidance = getPlannerGuidance({
      role: 'planner',
      teamRoles: ['planner'],
      isEntryPoint: true,
      convexUrl: CONVEX_URL,
    });

    expect(guidance).toContain('Operating model: Planner Solo');
    expect(guidance).not.toContain('reviewer');

    const handoffRulesMatch = guidance.match(
      /\*\*Handoff Rules:\*\*[\s\S]*?(?=\n\n\*\*|\n## |\n$)/
    );
    const handoffRulesSection = handoffRulesMatch ? handoffRulesMatch[0] : '(not found)';

    expect(handoffRulesSection).toMatchInlineSnapshot(`
      "**Handoff Rules:**

      ⚠️ After ANY handoff (including to \`user\`), you must run \`get-next-task\` to stay in the session.

      - **To implement** → Work on the chatroom task directly (you are acting as implementer)
      - **For rework** → Revise your implementation directly and re-validate
      - **To deliver to user** → Hand off to \`user\` with a complete, standalone summary
        ⚠️ The user can ONLY see the handoff-to-user message — progress reports and all other messages are invisible to them. Write the handoff as a self-contained document: include all relevant context, results, and next steps without assuming the user read any prior conversation."
    `);
  });

  test('duo team: Delegation Guidelines mentions builder-specific instruction', () => {
    const guidance = getPlannerGuidance({
      role: 'planner',
      teamRoles: ['planner', 'builder'],
      isEntryPoint: true,
      convexUrl: CONVEX_URL,
    });
    expect(guidance).toContain(
      'Feed slices to the builder incrementally — one at a time, not all at once'
    );
    expect(guidance).not.toContain('tackle one layer at a time');
  });

  test('solo planner: Delegation Guidelines mentions self-implementation instruction', () => {
    const guidance = getPlannerGuidance({
      role: 'planner',
      teamRoles: ['planner'],
      isEntryPoint: true,
      convexUrl: CONVEX_URL,
    });
    expect(guidance).toContain('tackle one layer at a time');
    expect(guidance).not.toContain('Feed slices to the builder incrementally');
  });

  test('duo team: Quality Accountability mentions builder for rework', () => {
    const guidance = getPlannerGuidance({
      role: 'planner',
      teamRoles: ['planner', 'builder'],
      isEntryPoint: true,
      convexUrl: CONVEX_URL,
    });
    expect(guidance).toContain(
      "If the user's requirements are not met, hand work back to the builder for rework."
    );
    expect(guidance).not.toContain('revise it yourself before delivering');
  });

  test('solo planner: Quality Accountability mentions self-revision', () => {
    const guidance = getPlannerGuidance({
      role: 'planner',
      teamRoles: ['planner'],
      isEntryPoint: true,
      convexUrl: CONVEX_URL,
    });
    expect(guidance).toContain(
      "If the work doesn't meet requirements, revise it yourself before delivering."
    );
    expect(guidance).not.toContain('hand work back to the builder');
  });
});

describe('getBuilderGuidance', () => {
  test('duo builder defaults to planner handoff target', () => {
    const guidance = getBuilderGuidance({
      role: 'builder',
      teamRoles: ['planner', 'builder'],
      isEntryPoint: false,
      convexUrl: CONVEX_URL,
      codeChangesTarget: 'planner',
      questionTarget: 'planner',
    });

    expect(guidance).not.toContain('reviewer');
    expect(guidance).toContain('Hand off to `planner`');
  });

  test('duo builder snapshot', () => {
    const guidance = getBuilderGuidance({
      role: 'builder',
      teamRoles: ['planner', 'builder'],
      isEntryPoint: false,
      convexUrl: CONVEX_URL,
      codeChangesTarget: 'planner',
      questionTarget: 'planner',
    });

    expect(guidance).toMatchInlineSnapshot(`
      "
      ## Builder Operating Model

      Completing a **chatroom task** (Level B) does NOT end your **session** (Level A). After every handoff, run \`get-next-task\` to continue.

      You are responsible for implementing code changes based on requirements.

      **Typical Flow:**

      \`\`\`mermaid
      flowchart TD
          A([Start]) --> B[Receive chatroom task]
          B --> D[Implement changes]
          D --> E[Commit work]
          E --> F{Code changes?}
          F -->|yes| G[Hand off to **planner**]
          F -->|no| H[Hand off to **planner**]
      \`\`\`

      **Handoff Rules:**
      - **After code changes** → Hand off to \`planner\`
      - **For simple questions** → Can hand off directly to \`planner\`
        ⚠️ If \`planner\` is the user: the user can ONLY see the handoff-to-user message — progress reports and all other messages are invisible to them. Write the handoff as a complete, self-contained document: include all relevant context, results, and next steps without assuming the user read any prior conversation.

      **Role-owned handoff contracts:** Before work that may require a handoff, inspect your role's contract and renderable templates:
      \`\`\`bash
      chatroom handoff list-templates --role="builder" --team-id="duo"
      \`\`\`
      This lists who you receive work from, who you return to, and every outbound handoff template you can use.

      **Implementation Guidelines:**
      - Write clean, maintainable, well-documented code
      - Follow established patterns and best practices from the codebase
      - Handle edge cases and error scenarios
      - Commit work with descriptive, atomic commit messages

      **Completion gates (before PR or handoff):**
      - All **(Required)** files done; **verified end-to-end** (user-facing entry point works: CLI command runnable, API reachable, or UI action functional)
      - If blocked → ## Blockers / questions to planner. No PR or \`mark-for-review\` until gates pass — unless the user explicitly requested a draft or incremental PR
      "
    `);
  });
});

describe('getRoleGuidanceFromContext - duo team', () => {
  test('duo planner should produce duo-specific guidance', () => {
    const ctx = buildSelectorContext({
      role: 'planner',
      teamRoles: ['planner', 'builder'],
      teamName: 'Duo',
      teamEntryPoint: 'planner',
      convexUrl: CONVEX_URL,
    });

    const guidance = getRoleGuidanceFromContext(ctx);

    expect(guidance).toContain('Duo Team Context');
    expect(guidance).toContain('Planner + Builder');
    expect(guidance).not.toContain('reviewer');
  });

  test('duo builder should produce duo-specific guidance', () => {
    const ctx = buildSelectorContext({
      role: 'builder',
      teamRoles: ['planner', 'builder'],
      teamName: 'Duo',
      teamEntryPoint: 'planner',
      convexUrl: CONVEX_URL,
    });

    const guidance = getRoleGuidanceFromContext(ctx);

    expect(guidance).toContain('Duo Team Context');
    expect(guidance).not.toContain('reviewer');
  });
});

describe('role guidance — handoff template discovery instruction', () => {
  test('planner guidance mentions inspecting role-owned handoff templates before work', () => {
    const guidance = getPlannerGuidance({
      role: 'planner',
      teamRoles: ['planner', 'builder'],
      isEntryPoint: true,
      convexUrl: CONVEX_URL,
    });

    expect(guidance).toContain('Role-owned handoff contracts');
    expect(guidance).toContain('chatroom handoff list-templates --role="planner" --team-id="duo"');
  });

  test('solo team planner guidance uses the solo team id in the discovery command', () => {
    const guidance = getPlannerGuidance({
      role: 'planner',
      teamRoles: ['planner'],
      isEntryPoint: true,
      convexUrl: CONVEX_URL,
    });

    expect(guidance).toContain('chatroom handoff list-templates');
  });

  test('builder guidance mentions inspecting role-owned handoff templates before implementation rules', () => {
    const guidance = getBuilderGuidance({
      role: 'builder',
      teamRoles: ['planner', 'builder'],
      isEntryPoint: false,
      convexUrl: CONVEX_URL,
      codeChangesTarget: 'planner',
      questionTarget: 'planner',
    });

    expect(guidance).toContain('Role-owned handoff contracts');
    expect(guidance).toContain('chatroom handoff list-templates --role="builder" --team-id="duo"');
    expect(guidance.indexOf('list-templates')).toBeLessThan(
      guidance.indexOf('**Implementation Guidelines:**')
    );
  });

  test('enhancer guidance mentions inspecting role-owned handoff templates without weakening restrictions', () => {
    const guidance = getEnhancerGuidance({
      role: 'enhancer',
      teamRoles: ['planner', 'builder', 'enhancer'],
      isEntryPoint: false,
      convexUrl: CONVEX_URL,
    });

    expect(guidance).toContain('Role-owned handoff contracts');
    expect(guidance).toContain('chatroom handoff list-templates --role="enhancer" --team-id="duo"');
    expect(guidance).toContain(
      'Do NOT implement, spawn subagents, or propose multiple alternative designs.'
    );
  });
});
