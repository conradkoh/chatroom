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

  test('advertises only the enforced contract targets for a trio specifier', () => {
    expect(
      buildAvailableHandoffRoles({
        teamId: 'trio',
        teamRoles: ['coordinator', 'specifier', 'builder'],
        currentRole: 'specifier',
        fallbackParticipantRoles: [],
      })
    ).toEqual(['coordinator', 'builder']);
  });

  test('advertises only the enforced contract targets for a trio builder', () => {
    expect(
      buildAvailableHandoffRoles({
        teamId: 'trio',
        teamRoles: ['coordinator', 'specifier', 'builder'],
        currentRole: 'builder',
        fallbackParticipantRoles: [],
      })
    ).toEqual(['specifier']);
  });

  test('advertises the trio coordinator contract order starting with user and without builder', () => {
    const targets = buildAvailableHandoffRoles({
      teamId: 'trio',
      teamRoles: ['coordinator', 'specifier', 'builder'],
      currentRole: 'coordinator',
      fallbackParticipantRoles: [],
    });

    expect(targets).toEqual([
      'user',
      'specifier',
      'architect',
      'uiux-engineer',
      'triage',
      'researcher',
      'reviewer',
      'game-asset-designer',
      'verifier',
    ]);
    expect(targets).not.toContain('builder');
  });

  test('advertises the trio specialist contract target for an ephemeral role', () => {
    expect(
      buildAvailableHandoffRoles({
        teamId: 'trio',
        teamRoles: ['coordinator', 'specifier', 'builder'],
        currentRole: 'architect',
        fallbackParticipantRoles: [],
      })
    ).toEqual(['coordinator']);
  });

  test('keeps advisory-team membership behaviour unchanged when a team id is supplied', () => {
    expect(
      buildAvailableHandoffRoles({
        teamId: 'duo',
        teamRoles: ['planner', 'architect', 'uiux-engineer', 'builder'],
        currentRole: 'planner',
        fallbackParticipantRoles: [],
      })
    ).toEqual(['architect', 'uiux-engineer', 'builder', 'user']);

    expect(
      buildAvailableHandoffRoles({
        teamId: 'solo',
        teamRoles: [],
        currentRole: 'solo',
        fallbackParticipantRoles: ['architect'],
      })
    ).toEqual(['architect', 'user']);
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
