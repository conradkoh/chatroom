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
      - **To deliver to user** → Hand off to \`user\` with a complete, standalone summary
        ⚠️ The user can ONLY see the handoff-to-user message — progress reports and all other messages are invisible to them. Write the handoff as a self-contained document: include all relevant context, results, and next steps without assuming the user read any prior conversation.
      - **For rework** → Hand off back to \`builder\` with specific feedback on what needs to change"
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
      - **To deliver to user** → Hand off to \`user\` with a complete, standalone summary
        ⚠️ The user can ONLY see the handoff-to-user message — progress reports and all other messages are invisible to them. Write the handoff as a self-contained document: include all relevant context, results, and next steps without assuming the user read any prior conversation.
      - **For rework** → Revise your implementation directly and re-validate"
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

      **Implementation Guidelines:**
      - Write clean, maintainable, well-documented code
      - Follow established patterns and best practices from the codebase
      - Handle edge cases and error scenarios
      - Commit work with descriptive, atomic commit messages
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
