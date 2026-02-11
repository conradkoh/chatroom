/**
 * Unit tests for SelectorContext adapters.
 *
 * Verifies that the new SelectorContext-based dispatchers produce the same
 * output as the existing role-specific parameter functions. This is the
 * correctness guarantee for Phase 1.2/1.3 of the prompt architecture refactor.
 */

import { describe, expect, test } from 'vitest';

import { getBuilderGuidance as getBaseBuilder } from '../../prompts/base/cli/roles/builder';
import { buildSelectorContext, getRoleGuidanceFromContext } from '../../prompts/generator';
import { getBuilderGuidance as getPairBuilder } from '../../prompts/teams/pair/prompts/builder';
import { getReviewerGuidance as getPairReviewer } from '../../prompts/teams/pair/prompts/reviewer';
import { getBuilderGuidance as getSquadBuilder } from '../../prompts/teams/squad/prompts/builder';
import { getPlannerGuidance as getSquadPlanner } from '../../prompts/teams/squad/prompts/planner';
import { getReviewerGuidance as getSquadReviewer } from '../../prompts/teams/squad/prompts/reviewer';

const CONVEX_URL = 'http://127.0.0.1:3210';

describe('buildSelectorContext', () => {
  test('builds correct context for squad planner', () => {
    const ctx = buildSelectorContext({
      role: 'planner',
      teamRoles: ['planner', 'builder', 'reviewer'],
      teamName: 'Squad Team',
      teamEntryPoint: 'planner',
      convexUrl: CONVEX_URL,
      chatroomId: 'test-room',
      availableMembers: ['planner', 'builder'],
    });

    expect(ctx.team).toBe('squad');
    expect(ctx.isEntryPoint).toBe(true);
    expect(ctx.availableMembers).toEqual(['planner', 'builder']);
  });

  test('builds correct context for pair builder', () => {
    const ctx = buildSelectorContext({
      role: 'builder',
      teamRoles: ['builder', 'reviewer'],
      teamName: 'Pair Team',
      teamEntryPoint: 'builder',
      convexUrl: CONVEX_URL,
    });

    expect(ctx.team).toBe('pair');
    expect(ctx.isEntryPoint).toBe(true);
  });

  test('detects unknown team type', () => {
    const ctx = buildSelectorContext({
      role: 'builder',
      teamRoles: ['builder', 'custom-role'],
      teamName: 'Custom Team',
      convexUrl: CONVEX_URL,
    });

    expect(ctx.team).toBe('unknown');
  });
});

describe('getRoleGuidanceFromContext — Squad Team', () => {
  const squadRoles = ['planner', 'builder', 'reviewer'];

  test('squad planner matches existing function output', () => {
    const ctx = buildSelectorContext({
      role: 'planner',
      teamRoles: squadRoles,
      teamName: 'Squad',
      teamEntryPoint: 'planner',
      convexUrl: CONVEX_URL,
      availableMembers: ['planner', 'builder', 'reviewer'],
    });

    const fromContext = getRoleGuidanceFromContext(ctx);
    const existing = getSquadPlanner({
      role: 'planner',
      teamRoles: squadRoles,
      isEntryPoint: true,
      convexUrl: CONVEX_URL,
      availableMembers: ['planner', 'builder', 'reviewer'],
    });

    expect(fromContext).toBe(existing);
  });

  test('squad builder matches existing function output', () => {
    const ctx = buildSelectorContext({
      role: 'builder',
      teamRoles: squadRoles,
      teamName: 'Squad',
      teamEntryPoint: 'planner',
      convexUrl: CONVEX_URL,
    });

    const fromContext = getRoleGuidanceFromContext(ctx);
    const existing = getSquadBuilder({
      role: 'builder',
      teamRoles: squadRoles,
      isEntryPoint: false,
      convexUrl: CONVEX_URL,
    });

    expect(fromContext).toBe(existing);
  });

  test('squad reviewer matches existing function output', () => {
    const ctx = buildSelectorContext({
      role: 'reviewer',
      teamRoles: squadRoles,
      teamName: 'Squad',
      teamEntryPoint: 'planner',
      convexUrl: CONVEX_URL,
    });

    const fromContext = getRoleGuidanceFromContext(ctx);
    const existing = getSquadReviewer({
      role: 'reviewer',
      teamRoles: squadRoles,
      isEntryPoint: false,
      convexUrl: CONVEX_URL,
    });

    expect(fromContext).toBe(existing);
  });
});

describe('getRoleGuidanceFromContext — Pair Team', () => {
  const pairRoles = ['builder', 'reviewer'];

  test('pair builder matches existing function output', () => {
    const ctx = buildSelectorContext({
      role: 'builder',
      teamRoles: pairRoles,
      teamName: 'Pair',
      teamEntryPoint: 'builder',
      convexUrl: CONVEX_URL,
    });

    const fromContext = getRoleGuidanceFromContext(ctx);
    const existing = getPairBuilder({
      role: 'builder',
      teamRoles: pairRoles,
      isEntryPoint: true,
      convexUrl: CONVEX_URL,
    });

    expect(fromContext).toBe(existing);
  });

  test('pair reviewer matches existing function output', () => {
    const ctx = buildSelectorContext({
      role: 'reviewer',
      teamRoles: pairRoles,
      teamName: 'Pair',
      teamEntryPoint: 'builder',
      convexUrl: CONVEX_URL,
    });

    const fromContext = getRoleGuidanceFromContext(ctx);
    const existing = getPairReviewer({
      role: 'reviewer',
      teamRoles: pairRoles,
      isEntryPoint: false,
      convexUrl: CONVEX_URL,
    });

    expect(fromContext).toBe(existing);
  });
});

describe('getRoleGuidanceFromContext — Unknown Team (base fallback)', () => {
  const customRoles = ['builder', 'custom-role'];

  test('unknown team builder falls back to base guidance', () => {
    const ctx = buildSelectorContext({
      role: 'builder',
      teamRoles: customRoles,
      teamName: 'Custom',
      convexUrl: CONVEX_URL,
    });

    const fromContext = getRoleGuidanceFromContext(ctx);
    const existing = getBaseBuilder({
      role: 'builder',
      teamRoles: customRoles,
      isEntryPoint: true, // first role is entry point
      convexUrl: CONVEX_URL,
    });

    expect(fromContext).toBe(existing);
  });

  test('unknown team returns empty string for unrecognized role', () => {
    const ctx = buildSelectorContext({
      role: 'custom-role',
      teamRoles: customRoles,
      teamName: 'Custom',
      convexUrl: CONVEX_URL,
    });

    const fromContext = getRoleGuidanceFromContext(ctx);
    expect(fromContext).toBe('');
  });
});

describe('getRoleGuidanceFromContext — planner availability variants', () => {
  const squadRoles = ['planner', 'builder', 'reviewer'];

  test('planner with no available members gets solo workflow', () => {
    const ctx = buildSelectorContext({
      role: 'planner',
      teamRoles: squadRoles,
      teamName: 'Squad',
      teamEntryPoint: 'planner',
      convexUrl: CONVEX_URL,
      availableMembers: ['planner'],
    });

    const result = getRoleGuidanceFromContext(ctx);
    expect(result).toContain('Planner Solo');
    expect(result).toContain('working solo');
  });

  test('planner with builder available gets planner+builder workflow', () => {
    const ctx = buildSelectorContext({
      role: 'planner',
      teamRoles: squadRoles,
      teamName: 'Squad',
      teamEntryPoint: 'planner',
      convexUrl: CONVEX_URL,
      availableMembers: ['planner', 'builder'],
    });

    const result = getRoleGuidanceFromContext(ctx);
    expect(result).toContain('Planner + Builder');
  });

  test('planner with full team gets full workflow', () => {
    const ctx = buildSelectorContext({
      role: 'planner',
      teamRoles: squadRoles,
      teamName: 'Squad',
      teamEntryPoint: 'planner',
      convexUrl: CONVEX_URL,
      availableMembers: ['planner', 'builder', 'reviewer'],
    });

    const result = getRoleGuidanceFromContext(ctx);
    expect(result).toContain('Full Team');
  });
});
