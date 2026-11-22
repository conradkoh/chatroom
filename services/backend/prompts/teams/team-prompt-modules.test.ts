import { afterEach, describe, expect, test, vi } from 'vitest';

import { getBaseRoleGuidanceFromContext } from '../cli/roles/fromContext';
import { buildSelectorContext, getRoleGuidanceFromContext } from '../selector-context';
import { isPresetTeam, TEAM_PROMPT_MODULES } from './registry';

const CONVEX_URL = 'http://127.0.0.1:3210';

const duoPlanner = buildSelectorContext({
  role: 'planner',
  teamRoles: ['planner', 'builder'],
  teamName: 'Duo',
  teamEntryPoint: 'planner',
  convexUrl: CONVEX_URL,
});
const duoArchitect = buildSelectorContext({
  role: 'architect',
  teamRoles: ['planner', 'builder', 'architect'],
  teamName: 'Duo',
  teamEntryPoint: 'planner',
  convexUrl: CONVEX_URL,
});
const soloSolo = buildSelectorContext({
  role: 'solo',
  teamRoles: ['solo'],
  teamName: 'Solo',
  teamEntryPoint: 'solo',
  convexUrl: CONVEX_URL,
});
const trioCoordinator = buildSelectorContext({
  role: 'coordinator',
  teamRoles: ['coordinator', 'specifier', 'builder'],
  teamName: 'Trio',
  teamEntryPoint: 'coordinator',
  convexUrl: CONVEX_URL,
});
const unknownBuilder = buildSelectorContext({
  role: 'builder',
  teamRoles: ['builder', 'custom-role'],
  teamName: 'Custom',
  convexUrl: CONVEX_URL,
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('isPresetTeam', () => {
  test('preset ids are preset teams; unknown names and prototype keys are not', () => {
    expect(isPresetTeam('duo')).toBe(true);
    expect(isPresetTeam('solo')).toBe(true);
    expect(isPresetTeam('trio')).toBe(true);
    expect(isPresetTeam('unknown')).toBe(false);
    expect(isPresetTeam('constructor')).toBe(false);
  });
});

describe('role guidance through the team registry', () => {
  test.each([
    ['duo planner', duoPlanner],
    ['trio coordinator', trioCoordinator],
  ])('%s gets team guidance, not the base guidance', (_label, ctx) => {
    expect(getRoleGuidanceFromContext(ctx)).not.toBe(getBaseRoleGuidanceFromContext(ctx));
  });

  test('solo guidance comes from the solo module', () => {
    // Solo's dedicated guidance is the same text as the base solo guidance, so
    // assert the module handles the role and that dispatch returns its result.
    const teamGuidance = TEAM_PROMPT_MODULES.solo.getRoleGuidance(soloSolo);
    expect(teamGuidance).not.toBeNull();
    expect(getRoleGuidanceFromContext(soloSolo)).toBe(teamGuidance);
    expect(teamGuidance).toBe(getBaseRoleGuidanceFromContext(soloSolo));
  });

  test('a preset role without team guidance falls back to base', () => {
    expect(getRoleGuidanceFromContext(duoArchitect)).toBe(
      getBaseRoleGuidanceFromContext(duoArchitect)
    );
  });

  test('an unknown team falls back to base', () => {
    expect(getRoleGuidanceFromContext(unknownBuilder)).toBe(
      getBaseRoleGuidanceFromContext(unknownBuilder)
    );
  });

  test('a throwing team guidance falls back to base instead of surfacing', () => {
    const base = getBaseRoleGuidanceFromContext(duoPlanner);
    vi.spyOn(TEAM_PROMPT_MODULES.duo, 'getRoleGuidance').mockImplementation(() => {
      throw new Error('team guidance failed');
    });

    expect(getRoleGuidanceFromContext(duoPlanner)).toBe(base);
  });
});
