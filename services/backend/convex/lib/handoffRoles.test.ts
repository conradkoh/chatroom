/** Pure unit tests for the generic configured handoff capability list. */

import { describe, expect, test } from 'vitest';

import { buildAvailableHandoffRoles } from './handoffRoles';

describe('buildAvailableHandoffRoles', () => {
  test('includes configured ephemeral roles like any other configured role', () => {
    expect(
      buildAvailableHandoffRoles({
        teamRoles: ['planner', 'enhancer', 'builder'],
        currentRole: 'planner',
        fallbackParticipantRoles: [],
      })
    ).toEqual(['enhancer', 'builder', 'user']);
  });

  test('does not inject an ephemeral role when it is absent', () => {
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
        fallbackParticipantRoles: ['builder', 'enhancer'],
      })
    ).toEqual(['builder', 'enhancer', 'user']);

    expect(
      buildAvailableHandoffRoles({
        teamRoles: ['planner', 'builder'],
        currentRole: 'planner',
        fallbackParticipantRoles: ['enhancer'],
      })
    ).toEqual(['builder', 'user']);
  });
});
