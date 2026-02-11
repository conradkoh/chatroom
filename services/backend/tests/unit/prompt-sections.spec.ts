/**
 * Unit tests for standalone prompt sections.
 *
 * Verifies that extracted sections produce correct output for different
 * SelectorContext combinations.
 *
 * Phase 2 of the prompt engineering architecture refactor.
 */

import { describe, expect, test } from 'vitest';

import { buildSelectorContext } from '../../prompts/generator';
import {
  getRoleDescriptionSection,
  getRoleTitleSection,
  getTeamHeaderSection,
} from '../../prompts/sections/role-identity';
import { getTeamContextSection } from '../../prompts/sections/team-context';

const CONVEX_URL = 'http://127.0.0.1:3210';

describe('getTeamContextSection', () => {
  describe('squad team', () => {
    test('planner gets squad coordinator context', () => {
      const ctx = buildSelectorContext({
        role: 'planner',
        teamRoles: ['planner', 'builder', 'reviewer'],
        teamName: 'Squad',
        teamEntryPoint: 'planner',
        convexUrl: CONVEX_URL,
        availableMembers: ['planner', 'builder', 'reviewer'],
      });

      const section = getTeamContextSection(ctx);
      expect(section.id).toBe('team-context');
      expect(section.type).toBe('knowledge');
      expect(section.content).toContain('Squad Team Context');
      expect(section.content).toContain('ONLY role that communicates directly with the user');
      expect(section.content).toContain('Builder is available');
      expect(section.content).toContain('Reviewer is available');
    });

    test('planner with no builder shows unavailability', () => {
      const ctx = buildSelectorContext({
        role: 'planner',
        teamRoles: ['planner', 'builder', 'reviewer'],
        teamName: 'Squad',
        teamEntryPoint: 'planner',
        convexUrl: CONVEX_URL,
        availableMembers: ['planner'],
      });

      const section = getTeamContextSection(ctx);
      expect(section.content).toContain('Builder is NOT available');
      expect(section.content).toContain('Reviewer is NOT available');
    });

    test('builder gets squad builder context with user restriction', () => {
      const ctx = buildSelectorContext({
        role: 'builder',
        teamRoles: ['planner', 'builder', 'reviewer'],
        teamName: 'Squad',
        teamEntryPoint: 'planner',
        convexUrl: CONVEX_URL,
      });

      const section = getTeamContextSection(ctx);
      expect(section.content).toContain('Squad Team Context');
      expect(section.content).toContain('do NOT communicate directly with the user');
      expect(section.content).toContain('NEVER hand off directly to');
    });

    test('reviewer gets squad reviewer context with user restriction', () => {
      const ctx = buildSelectorContext({
        role: 'reviewer',
        teamRoles: ['planner', 'builder', 'reviewer'],
        teamName: 'Squad',
        teamEntryPoint: 'planner',
        convexUrl: CONVEX_URL,
      });

      const section = getTeamContextSection(ctx);
      expect(section.content).toContain('Squad Team Context');
      expect(section.content).toContain('do NOT communicate directly with the user');
      expect(section.content).toContain('NEVER hand off directly to');
      expect(section.content).toContain('planner');
    });
  });

  describe('pair team', () => {
    test('builder gets pair builder context', () => {
      const ctx = buildSelectorContext({
        role: 'builder',
        teamRoles: ['builder', 'reviewer'],
        teamName: 'Pair',
        teamEntryPoint: 'builder',
        convexUrl: CONVEX_URL,
      });

      const section = getTeamContextSection(ctx);
      expect(section.content).toContain('Pair Team Context');
      expect(section.content).toContain('reviewer who will check your code');
    });

    test('reviewer gets pair reviewer context', () => {
      const ctx = buildSelectorContext({
        role: 'reviewer',
        teamRoles: ['builder', 'reviewer'],
        teamName: 'Pair',
        teamEntryPoint: 'builder',
        convexUrl: CONVEX_URL,
      });

      const section = getTeamContextSection(ctx);
      expect(section.content).toContain('Pair Team Context');
      expect(section.content).toContain('builder who implements code');
    });
  });

  describe('unknown team', () => {
    test('returns empty content for unknown team', () => {
      const ctx = buildSelectorContext({
        role: 'builder',
        teamRoles: ['builder', 'custom-role'],
        teamName: 'Custom',
        convexUrl: CONVEX_URL,
      });

      const section = getTeamContextSection(ctx);
      expect(section.id).toBe('team-context');
      expect(section.content).toBe('');
    });
  });
});

describe('role identity sections', () => {
  test('getTeamHeaderSection produces correct header', () => {
    const section = getTeamHeaderSection('Squad Team');
    expect(section.id).toBe('team-header');
    expect(section.type).toBe('knowledge');
    expect(section.content).toBe('# Squad Team');
  });

  test('getRoleTitleSection produces correct title for planner', () => {
    const ctx = buildSelectorContext({
      role: 'planner',
      teamRoles: ['planner', 'builder', 'reviewer'],
      teamName: 'Squad',
      teamEntryPoint: 'planner',
      convexUrl: CONVEX_URL,
    });

    const section = getRoleTitleSection(ctx);
    expect(section.id).toBe('role-title');
    expect(section.type).toBe('knowledge');
    expect(section.content).toContain('PLANNER');
  });

  test('getRoleTitleSection produces correct title for builder', () => {
    const ctx = buildSelectorContext({
      role: 'builder',
      teamRoles: ['builder', 'reviewer'],
      teamName: 'Pair',
      teamEntryPoint: 'builder',
      convexUrl: CONVEX_URL,
    });

    const section = getRoleTitleSection(ctx);
    expect(section.content).toContain('BUILDER');
  });

  test('getRoleDescriptionSection produces role description', () => {
    const ctx = buildSelectorContext({
      role: 'planner',
      teamRoles: ['planner', 'builder', 'reviewer'],
      teamName: 'Squad',
      teamEntryPoint: 'planner',
      convexUrl: CONVEX_URL,
    });

    const section = getRoleDescriptionSection(ctx);
    expect(section.id).toBe('role-description');
    expect(section.type).toBe('knowledge');
    expect(section.content).toContain('team coordinator');
  });
});
