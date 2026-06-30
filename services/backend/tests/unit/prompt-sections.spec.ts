/**
 * Unit tests for standalone prompt sections.
 *
 * Verifies that extracted sections produce correct output for different
 * SelectorContext combinations.
 *
 * Phase 2 of the prompt engineering architecture refactor.
 */

import { describe, expect, test } from 'vitest';

import { getAvailableActions } from '../../prompts/cli/get-next-task/available-actions';
import {
  getRoleDescriptionSection,
  getRoleTitleSection,
  getTeamHeaderSection,
} from '../../prompts/sections/role-identity';
import { getTeamContextSection } from '../../prompts/sections/team-context';
import { buildSelectorContext } from '../../prompts/selector-context';

const CONVEX_URL = 'http://127.0.0.1:3210';

describe('getTeamContextSection', () => {
  describe('duo team', () => {
    test('planner gets duo coordinator context', () => {
      const ctx = buildSelectorContext({
        role: 'planner',
        teamRoles: ['planner', 'builder'],
        teamName: 'Duo',
        teamEntryPoint: 'planner',
        convexUrl: CONVEX_URL,
      });

      const section = getTeamContextSection(ctx);
      expect(section.id).toBe('team-context');
      expect(section.type).toBe('knowledge');
      expect(section.content).toContain('Duo Team Context');
      expect(section.content).toContain('communicate directly with the user');
      expect(section.content).toContain('Only you can hand off to');
    });

    test('builder gets duo builder context with user restriction', () => {
      const ctx = buildSelectorContext({
        role: 'builder',
        teamRoles: ['planner', 'builder'],
        teamName: 'Duo',
        teamEntryPoint: 'planner',
        convexUrl: CONVEX_URL,
      });

      const section = getTeamContextSection(ctx);
      expect(section.content).toContain('Duo Team Context');
      expect(section.content).toContain('do NOT communicate directly with the user');
      expect(section.content).toContain('NEVER hand off directly to');
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

describe('getAvailableActions', () => {
  test('entry point role includes Context Management section', () => {
    const output = getAvailableActions({
      chatroomId: 'test-chatroom-id',
      role: 'planner',
      convexUrl: 'http://127.0.0.1:3210',
      isEntryPoint: true,
    });
    expect(output).toContain('### Context Management');
    expect(output).toContain('context new');
    expect(output).toContain('Only the entry point role can create new contexts');
  });

  test('non-entry-point role does not include Context Management section', () => {
    const output = getAvailableActions({
      chatroomId: 'test-chatroom-id',
      role: 'builder',
      convexUrl: 'http://127.0.0.1:3210',
      isEntryPoint: false,
    });
    expect(output).not.toContain('### Context Management');
    expect(output).not.toContain('Only the entry point role can create new contexts');
  });
});

describe('role identity sections', () => {
  test('getTeamHeaderSection produces correct header', () => {
    const section = getTeamHeaderSection('Duo Team');
    expect(section.id).toBe('team-header');
    expect(section.type).toBe('knowledge');
    expect(section.content).toBe('# Duo Team');
  });

  test('getRoleTitleSection produces correct title for planner', () => {
    const ctx = buildSelectorContext({
      role: 'planner',
      teamRoles: ['planner', 'builder'],
      teamName: 'Duo',
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
      teamRoles: ['planner', 'builder'],
      teamName: 'Duo',
      teamEntryPoint: 'planner',
      convexUrl: CONVEX_URL,
    });

    const section = getRoleTitleSection(ctx);
    expect(section.content).toContain('BUILDER');
  });

  test('getRoleDescriptionSection produces role description', () => {
    const ctx = buildSelectorContext({
      role: 'planner',
      teamRoles: ['planner', 'builder'],
      teamName: 'Duo',
      teamEntryPoint: 'planner',
      convexUrl: CONVEX_URL,
    });

    const section = getRoleDescriptionSection(ctx);
    expect(section.id).toBe('role-description');
    expect(section.type).toBe('knowledge');
    expect(section.content).toContain('team coordinator');
  });
});
