/**
 * Tests for hardcoded role names in prompt system.
 *
 * Detects instances where role names (reviewer, builder, planner) are
 * hardcoded into prompts when they should be conditional based on team config.
 *
 * Uses inline snapshots to visualize rendered prompt content.
 */

import { describe, expect, test } from 'vitest';

import { getPlannerGuidance } from '../../prompts/base/cli/roles/planner';
import { getBuilderGuidance } from '../../prompts/base/cli/roles/builder';
import { buildSelectorContext, getRoleGuidanceFromContext } from '../../prompts/generator';

const CONVEX_URL = 'http://127.0.0.1:3210';

// =============================================================================
// Planner Guidance Tests
// =============================================================================

describe('getPlannerGuidance - Handoff Rules should be conditional on team members', () => {
  /**
   * BUG: The "Handoff Rules" section unconditionally includes:
   *   - "Hand off to `reviewer`" even when no reviewer exists
   *   - "Hand off to `builder`" even when no builder exists
   *
   * These should only appear when the respective role is available.
   */

  test('duo team planner (builder only, no reviewer) should NOT mention reviewer in Handoff Rules', () => {
    const guidance = getPlannerGuidance({
      role: 'planner',
      teamRoles: ['planner', 'builder'],
      isEntryPoint: true,
      convexUrl: CONVEX_URL,
      availableMembers: ['planner', 'builder'],
    });

    // The workflow section correctly shows "Planner + Builder (no reviewer)"
    expect(guidance).toContain('Current Workflow: Planner + Builder (no reviewer)');

    // BUG: The Handoff Rules section still hardcodes reviewer
    // This should NOT contain reviewer handoff rule since duo has no reviewer
    expect(guidance).not.toContain('**To request review** → Hand off to `reviewer`');
  });

  test('duo team planner - Handoff Rules snapshot', () => {
    const guidance = getPlannerGuidance({
      role: 'planner',
      teamRoles: ['planner', 'builder'],
      isEntryPoint: true,
      convexUrl: CONVEX_URL,
      availableMembers: ['planner', 'builder'],
    });

    // Extract just the Handoff Rules section
    const handoffRulesMatch = guidance.match(/\*\*Handoff Rules:\*\*[\s\S]*?(?=\n\n\*\*|\n## |\n$)/);
    const handoffRulesSection = handoffRulesMatch ? handoffRulesMatch[0] : '(not found)';

    expect(handoffRulesSection).toMatchInlineSnapshot(`
      "**Handoff Rules:**
      - **To delegate implementation** → Hand off to \`builder\` with clear requirements

      - **To deliver to user** → Hand off to \`user\` with a summary of what was done
      - **For rework** → Hand off back to \`builder\` with specific feedback on what needs to change"
    `);

    // ❌ The handoff rules INCORRECTLY mention reviewer for a duo team (no reviewer)
    // EXPECTED (after fix):
    // "**Handoff Rules:**
    // - **To delegate implementation** → Hand off to `builder` with clear requirements
    // - **To deliver to user** → Hand off to `user` with a summary of what was done
    // - **For rework** → Hand off back to `builder` with specific feedback on what needs to change"
  });

  test('full team planner (builder + reviewer) SHOULD mention reviewer in Handoff Rules', () => {
    const guidance = getPlannerGuidance({
      role: 'planner',
      teamRoles: ['planner', 'builder', 'reviewer'],
      isEntryPoint: true,
      convexUrl: CONVEX_URL,
      availableMembers: ['planner', 'builder', 'reviewer'],
    });

    expect(guidance).toContain('Current Workflow: Full Team (Planner + Builder + Reviewer)');
    expect(guidance).toContain('**To request review** → Hand off to `reviewer`');
    expect(guidance).toContain('**To delegate implementation** → Hand off to `builder`');
  });

  test('solo planner (no builder, no reviewer) should have simplified Handoff Rules', () => {
    const guidance = getPlannerGuidance({
      role: 'planner',
      teamRoles: ['planner'],
      isEntryPoint: true,
      convexUrl: CONVEX_URL,
      availableMembers: ['planner'],
    });

    expect(guidance).toContain('Current Workflow: Planner Solo');

    // Should NOT mention builder or reviewer in handoff rules when solo
    const handoffRulesMatch = guidance.match(/\*\*Handoff Rules:\*\*[\s\S]*?(?=\n\n\*\*|\n## |\n$)/);
    const handoffRulesSection = handoffRulesMatch ? handoffRulesMatch[0] : '(not found)';

    expect(handoffRulesSection).toMatchInlineSnapshot(`
      "**Handoff Rules:**


      - **To deliver to user** → Hand off to \`user\` with a summary of what was done
      "
    `);

    // ❌ The handoff rules INCORRECTLY mention builder and reviewer for a solo team
    // EXPECTED (after fix): Only delivery to user since there are no other members
  });

  test('planner + reviewer only (no builder) should NOT mention builder in Handoff Rules', () => {
    const guidance = getPlannerGuidance({
      role: 'planner',
      teamRoles: ['planner', 'reviewer'],
      isEntryPoint: true,
      convexUrl: CONVEX_URL,
      availableMembers: ['planner', 'reviewer'],
    });

    expect(guidance).toContain('Current Workflow: Planner + Reviewer (no builder)');

    // Should NOT mention builder in handoff rules
    const handoffRulesMatch = guidance.match(/\*\*Handoff Rules:\*\*[\s\S]*?(?=\n\n\*\*|\n## |\n$)/);
    const handoffRulesSection = handoffRulesMatch ? handoffRulesMatch[0] : '(not found)';

    expect(handoffRulesSection).toMatchInlineSnapshot(`
      "**Handoff Rules:**

      - **To request review** → Hand off to \`reviewer\` with context about what to check
      - **To deliver to user** → Hand off to \`user\` with a summary of what was done
      "
    `);

    // ❌ The handoff rules INCORRECTLY mention builder (delegation) for a planner+reviewer team
    // EXPECTED (after fix): Only delegation to reviewer and delivery to user
  });
});

// =============================================================================
// Builder Guidance Tests
// =============================================================================

describe('getBuilderGuidance - reviewer-related content should be conditional', () => {
  test('duo builder (codeChangesTarget=planner) should NOT mention reviewer', () => {
    const guidance = getBuilderGuidance({
      role: 'builder',
      teamRoles: ['planner', 'builder'],
      isEntryPoint: false,
      convexUrl: CONVEX_URL,
      codeChangesTarget: 'planner',
      questionTarget: 'planner',
    });

    // The "When you receive handoffs from the reviewer" section is correctly gated
    expect(guidance).not.toContain('When you receive handoffs from the reviewer');
    expect(guidance).not.toContain('hand back to the reviewer');
  });

  test('duo builder snapshot - should show planner as target, no reviewer mentions', () => {
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
      ## Builder Workflow

      You are responsible for implementing code changes based on requirements.
      

      **Typical Flow:**

      \`\`\`
      @startuml
      start
      :Receive task;
      note right: from planner handoff
      :Implement changes;
      :Commit work;
      if (classification?) then (new_feature or code changes)
        :Hand off to **planner**;
      else (question)
        :Hand off to **planner**;
      endif
      stop
      @enduml
      \`\`\`

      **Handoff Rules:**
      - **After code changes** → Hand off to \`planner\`
      - **For simple questions** → Can hand off directly to \`planner\`
      - **For \`new_feature\` classification** → MUST hand off to \`planner\` (cannot skip planner)

      **Development Best Practices:**
      - Write clean, maintainable code
      - Add appropriate tests when applicable
      - Document complex logic
      - Follow existing code patterns and conventions
      - Consider edge cases and error handling

      **Git Workflow:**
      - Use descriptive commit messages
      - Create logical commits (one feature/change per commit)
      - Keep the working directory clean between commits
      - Use \`git status\`, \`git diff\` to review changes before committing
      "
    `);
  });

  test('pair builder (codeChangesTarget=reviewer) SHOULD mention reviewer', () => {
    const guidance = getBuilderGuidance({
      role: 'builder',
      teamRoles: ['builder', 'reviewer'],
      isEntryPoint: false,
      convexUrl: CONVEX_URL,
      codeChangesTarget: 'reviewer',
      questionTarget: 'user',
    });

    expect(guidance).toContain('When you receive handoffs from the reviewer');
    expect(guidance).toContain('hand back to the reviewer');
    expect(guidance).toContain('Hand off to `reviewer`');
  });
});

// =============================================================================
// Team-level role guidance tests via getRoleGuidanceFromContext
// =============================================================================

describe('getRoleGuidanceFromContext - duo team should produce correct guidance', () => {
  test('duo planner should produce workflow without reviewer references in Handoff Rules', () => {
    const ctx = buildSelectorContext({
      role: 'planner',
      teamRoles: ['planner', 'builder'],
      teamName: 'Duo',
      teamEntryPoint: 'planner',
      convexUrl: CONVEX_URL,
      availableMembers: ['planner', 'builder'],
    });

    const guidance = getRoleGuidanceFromContext(ctx);

    // Should show duo team context
    expect(guidance).toContain('Duo Team Context');

    // Workflow should show builder-only flow
    expect(guidance).toContain('Planner + Builder (no reviewer)');

    // BUG: Handoff Rules still incorrectly mention reviewer
    // After fix, this assertion should pass:
    expect(guidance).not.toContain('**To request review** → Hand off to `reviewer`');
  });

  test('duo builder should produce guidance without reviewer references', () => {
    const ctx = buildSelectorContext({
      role: 'builder',
      teamRoles: ['planner', 'builder'],
      teamName: 'Duo',
      teamEntryPoint: 'planner',
      convexUrl: CONVEX_URL,
      availableMembers: ['planner', 'builder'],
    });

    const guidance = getRoleGuidanceFromContext(ctx);

    // Should show duo team context
    expect(guidance).toContain('Duo Team Context');

    // Should not mention reviewer (no reviewer in duo)
    expect(guidance).not.toContain('When you receive handoffs from the reviewer');
  });

  test('squad planner (full team) guidance snapshot - Handoff Rules section', () => {
    const ctx = buildSelectorContext({
      role: 'planner',
      teamRoles: ['planner', 'builder', 'reviewer'],
      teamName: 'Squad',
      teamEntryPoint: 'planner',
      convexUrl: CONVEX_URL,
      availableMembers: ['planner', 'builder', 'reviewer'],
    });

    const guidance = getRoleGuidanceFromContext(ctx);

    // Full team should have all three handoff rules
    expect(guidance).toContain('**To delegate implementation** → Hand off to `builder`');
    expect(guidance).toContain('**To request review** → Hand off to `reviewer`');
    expect(guidance).toContain('**To deliver to user** → Hand off to `user`');
  });
});
