/**
 * Unit tests for the role-specific handoff templates.
 *
 * Covers the resolver dispatch and the structural guarantees the backlog
 * item requires:
 *  - planner → user report includes Proof (files changed) and a mermaid
 *    System Design section, in markdown.
 *  - planner → builder delegation brief includes goal/scope/requirements.
 *  - unknown role pairs resolve to null (caller falls back to free-form).
 */

import { describe, expect, test } from 'vitest';

import {
  getHandoffTemplate,
  getPlannerToBuilderHandoffTemplate,
  getPlannerToUserReportTemplate,
} from '../../../prompts/cli/handoff-templates';

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

  test('is case-insensitive on role names', () => {
    expect(getHandoffTemplate({ fromRole: 'Planner', toRole: 'USER' })).toBe(
      getPlannerToUserReportTemplate()
    );
  });

  test('returns null for role pairs without a specialized template', () => {
    expect(getHandoffTemplate({ fromRole: 'builder', toRole: 'user' })).toBeNull();
    expect(getHandoffTemplate({ fromRole: 'planner', toRole: 'reviewer' })).toBeNull();
  });
});

describe('handoff-templates > planner → user report', () => {
  const report = getPlannerToUserReportTemplate();

  test('requires a proof / files-changed section', () => {
    expect(report).toContain('## Proof — files changed');
  });

  test('requires a mermaid system design section', () => {
    expect(report).toContain('## System Design');
    expect(report).toContain('```mermaid');
  });

  test('requires a verification section', () => {
    expect(report).toContain('## Verification');
    expect(report).toContain('pnpm typecheck && pnpm test');
  });

  test('is markdown (fenced code block)', () => {
    expect(report).toContain('```markdown');
  });
});

describe('handoff-templates > planner → builder delegation brief', () => {
  const brief = getPlannerToBuilderHandoffTemplate();

  test('includes goal, scope, and acceptance criteria', () => {
    expect(brief).toContain('## Goal');
    expect(brief).toContain('## Scope & Files');
    expect(brief).toContain('## Requirements (acceptance criteria)');
  });

  test('frames structured workflows as optional, not required', () => {
    expect(brief).toContain('Out of scope');
  });
});
