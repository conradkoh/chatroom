/**
 * Unit tests for the role-specific handoff templates.
 *
 * Covers the resolver dispatch and the structural guarantees the backlog
 * item requires:
 *  - planner → user report includes Proof of Planning, Proof of Principle, Proof of Completion,
 *    backlog tasks implemented, backlog pending user review confirmation,
 *    decisions, Key tradeoffs, Tech debt observed, and a mermaid System
 *    Design section, all in markdown, with no optional fields.
 *  - planner → builder delegation brief includes goal/scope/requirements and
 *    has no optional fields ("Not Applicable" convention).
 *  - builder → planner handoff template includes template disclosure,
 *    proof of principle, proof of completion, verification, and blockers.
 *  - unknown role pairs resolve to null (caller falls back to free-form).
 */

import { describe, expect, test } from 'vitest';

import { getHandoffTemplate } from '../../../prompts/cli/handoff-templates';
import { getBuilderToPlannerHandoffTemplate } from '../../../prompts/teams/duo/handoff-templates/builder-to-planner';
import { getPlannerToBuilderHandoffTemplate } from '../../../prompts/teams/duo/handoff-templates/planner-to-builder';
import { getPlannerToUserReportTemplate } from '../../../prompts/teams/duo/handoff-templates/planner-to-user';

describe('handoff-templates > resolver', () => {
  test('resolves planner → builder to the delegation brief', () => {
    expect(getHandoffTemplate({ fromRole: 'planner', toRole: 'builder' })).toBe(
      getPlannerToBuilderHandoffTemplate()
    );
  });

  test('resolves planner → user to the report template', () => {
    expect(getHandoffTemplate({ fromRole: 'planner', toRole: 'user' })).toBe(
      getPlannerToUserReportTemplate()
    );
  });

  test('resolves builder → planner to the work-complete template', () => {
    expect(getHandoffTemplate({ fromRole: 'builder', toRole: 'planner' })).toBe(
      getBuilderToPlannerHandoffTemplate()
    );
  });

  test('is case-insensitive on role names', () => {
    expect(getHandoffTemplate({ fromRole: 'Planner', toRole: 'USER' })).toBe(
      getPlannerToUserReportTemplate()
    );
  });

  test('returns null for role pairs without a specialized template', () => {
    expect(getHandoffTemplate({ fromRole: 'builder', toRole: 'user' })).toBeNull();
    expect(getHandoffTemplate({ fromRole: 'planner', toRole: 'reviewer' })).toBeNull();
  });

  test('resolves solo → user to the solo report template', () => {
    const template = getHandoffTemplate({ teamId: 'solo', fromRole: 'solo', toRole: 'user' });
    expect(template).toContain('Report Template (Solo → User)');
    expect(template).toContain('## Proof — files changed');
  });
});

describe('handoff-templates > planner → user report', () => {
  const report = getPlannerToUserReportTemplate();

  test('requires template disclosure confirmation section', () => {
    expect(report).toContain('## Template Disclosure Confirmation');
    expect(report).toContain(
      'I confirm that I have seen this template at the start of any planning, before working on or delegating any task to the team'
    );
    expect(report).toContain(
      "I confirm that I've read and followed the role guidance before starting any work"
    );
    expect(report).toContain('chatroom get-role-guidance');
    expect(report).toContain('Role guidance is static for your role');
  });

  test('requires what changed with nested proof of principle and proof of completion sections', () => {
    expect(report).toContain('## Proof of Planning');
    expect(report).toContain('## What changed');
    expect(report).toContain('### Proof of Principle');
    expect(report).toContain('### Proof of Completion');
    expect(report).toContain('chatroom context read');
    expect(report).toContain(
      'I confirm that I read the current chatroom task context using the command below and that the goal stated in that context has been met'
    );
    expect(report).not.toMatch(/^## Proof of Principle/m);
    expect(report).toContain('Organization & Maintainability');
    expect(report).toContain('Static Evaluability and Provability');
  });

  test('requires backlog implementation and pending review confirmation sections', () => {
    expect(report).toContain('## Backlog Tasks Implemented');
    expect(report).toContain('## Backlog Pending User Review Confirmation');
    expect(report).toContain('pending_user_review');
    expect(report).toContain('chatroom backlog mark-for-review');
  });

  test('requires a mermaid system design section', () => {
    expect(report).toContain('## System Design');
    expect(report).toContain('```mermaid');
  });

  test('requires a code change verification section', () => {
    expect(report).toContain('## Code Change Verification');
    expect(report).toContain(
      '- [ ] I confirm that I have run `pnpm typecheck && pnpm test` (only required if code changes were made)'
    );
  });

  test('requires key technical decisions, tradeoffs, and tech debt sections', () => {
    expect(report).toContain('## Key Technical Decisions');
    expect(report).toContain('## Key Tradeoffs');
    expect(report).toContain('## Tech Debt Observed');
  });

  test('has no optional fields — instructs Not Applicable instead', () => {
    expect(report).toContain('Not Applicable');
    expect(report).not.toMatch(/—\s*optional/i);
  });

  test('is markdown (fenced code block)', () => {
    expect(report).toContain('```markdown');
  });

  test('includes recipient visibility callout for user', () => {
    expect(report).toContain('⚠️ **CRITICAL — Recipient visibility**');
    expect(report).toContain('handoff --next-role="user"');
    expect(report).toContain('including direct replies like "Hello!"');
  });
});

describe('handoff-templates > planner → builder delegation brief', () => {
  const brief = getPlannerToBuilderHandoffTemplate();

  test('includes summary, goal, quality bar, force multipliers, file-level scope, and acceptance criteria', () => {
    expect(brief).toContain('## Summary');
    expect(brief).toContain('## Goal');
    expect(brief).toContain('## Key Knowledge for High Quality Bar');
    expect(brief).toContain('## Force Multipliers');
    expect(brief).toContain('## Files to implement (exhaustive, file-level)');
    expect(brief).toContain('## Requirements (acceptance criteria)');
    expect(brief).toMatch(/every file|exhaustive/i);
    expect(brief).toMatch(/no ambiguity|cannot misinterpret|cannot guess wrong/i);
  });

  test('has no optional fields — Skills section is mandatory', () => {
    expect(brief).toContain('## Skills to activate');
    expect(brief).not.toContain('## Skills to activate (optional)');
    expect(brief).toContain('Not Applicable');
  });

  test('includes out of scope section', () => {
    expect(brief).toContain('## Out of scope');
  });

  test('requires per-file change blocks with code snippets', () => {
    expect(brief).toContain('**Change:**');
    expect(brief).toMatch(/### `path\/to\//);
    expect(brief).toMatch(/typescript/);
  });

  test('requires shared contracts with interfaces and reference snippets', () => {
    expect(brief).toContain('## Shared contracts (planner-owned)');
    expect(brief).toContain('### Interfaces & types');
    expect(brief).toContain('### Reference snippets');
    expect(brief).toMatch(/builder (implements|executes)/i);
    expect(brief).not.toMatch(/builder (owns|designs)/i);
  });

  test('requires what to avoid section', () => {
    expect(brief).toContain('## What to avoid');
    expect(brief).toMatch(/anti-patterns|recurring mistakes/i);
  });

  test('includes Session Augmentation section with new_session default tag', () => {
    expect(brief).toContain('## Session Augmentation');
    expect(brief).toContain('new_session');
    expect(brief).toContain('data:agent.session_augmentation=new_session');
    expect(brief).toContain('`compact`');
    expect(brief).not.toContain('## Restart new context');
  });

  test('includes recipient visibility callout for builder', () => {
    expect(brief).toContain('⚠️ **CRITICAL — Recipient visibility**');
    expect(brief).toContain('The `builder` agent');
    expect(brief).toContain('handoff --next-role="builder"');
  });
});

describe('handoff-templates > builder → planner handoff', () => {
  const handoff = getBuilderToPlannerHandoffTemplate();

  test('requires template disclosure confirmation', () => {
    expect(handoff).toContain('## Template Disclosure Confirmation');
    expect(handoff).toContain(
      'I confirm that I have seen this template at the start of this task, before implementing or modifying any code'
    );
    expect(handoff).toContain(
      "I confirm that I've read and followed the role guidance before starting any work"
    );
    expect(handoff).toContain('chatroom get-role-guidance');
  });

  test('requires proof of principle and proof of completion sections', () => {
    expect(handoff).toContain('## Summary');
    expect(handoff).toContain('## Proof of Principle');
    expect(handoff).toContain('## Proof of Completion');
    expect(handoff).toContain('chatroom context read');
    expect(handoff).toContain(
      'I confirm that I read the current chatroom task context using the command below and that the goal stated in that context has been met'
    );
    expect(handoff).toContain('Organization & Maintainability');
    expect(handoff).toContain('Static Evaluability and Provability');
  });

  test('includes code change verification section', () => {
    expect(handoff).toContain('## Code Change Verification');
    expect(handoff).toContain(
      '- [ ] I confirm that I have run `pnpm typecheck && pnpm test` (only required if code changes were made)'
    );
  });

  test('includes recipient visibility callout for planner', () => {
    expect(handoff).toContain('⚠️ **CRITICAL — Recipient visibility**');
    expect(handoff).toContain('The `planner` agent');
    expect(handoff).toContain('handoff --next-role="planner"');
  });
});
