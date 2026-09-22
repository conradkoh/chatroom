/** Pure unit tests for the generic configured handoff capability list. */

import { describe, expect, test } from 'vitest';

import { buildAvailableHandoffRoles } from './handoffRoles';

describe('buildAvailableHandoffRoles', () => {
  test('includes configured architect and UI/UX roles like any other configured role', () => {
    expect(
      buildAvailableHandoffRoles({
        teamRoles: ['planner', 'architect', 'uiux-engineer', 'builder'],
        currentRole: 'planner',
        fallbackParticipantRoles: [],
      })
    ).toEqual(['architect', 'uiux-engineer', 'builder', 'user']);
  });

  test('does not inject an architect or UI/UX role when absent', () => {
    expect(
      buildAvailableHandoffRoles({
        teamRoles: ['planner', 'builder'],
        currentRole: 'planner',
        fallbackParticipantRoles: [],
      })
    ).toEqual(['builder', 'user']);
  });

  test('excludes current role and user, deduplicating case-insensitively', () => {
    expect(
      buildAvailableHandoffRoles({
        teamRoles: ['Planner', 'BUILDER', 'builder', 'USER', 'user'],
        currentRole: 'planner',
        fallbackParticipantRoles: [],
      })
    ).toEqual(['BUILDER', 'user']);
  });

  test('uses fallback participants only when configured membership is empty', () => {
    expect(
      buildAvailableHandoffRoles({
        teamRoles: [],
        currentRole: 'planner',
        fallbackParticipantRoles: ['builder', 'architect'],
      })
    ).toEqual(['builder', 'architect', 'user']);

    expect(
      buildAvailableHandoffRoles({
        teamRoles: ['planner', 'builder'],
        currentRole: 'planner',
        fallbackParticipantRoles: ['architect'],
      })
    ).toEqual(['builder', 'user']);
  });

  test('omits retired enhancer roles from configured and fallback membership', () => {
    expect(
      buildAvailableHandoffRoles({
        teamRoles: ['planner', 'Enhancer', 'architect', 'UIUX-Engineer'],
        currentRole: 'planner',
        fallbackParticipantRoles: [],
      })
    ).toEqual(['architect', 'UIUX-Engineer', 'user']);

    expect(
      buildAvailableHandoffRoles({
        teamRoles: [],
        currentRole: 'planner',
        fallbackParticipantRoles: ['ENHANCER', 'architect'],
      })
    ).toEqual(['architect', 'user']);
  });
});
