/**
 * Pure unit tests for buildAvailableHandoffRoles.
 *
 * Covers the configured-membership-authoritative contract: current-role
 * exclusion, enhancer gating, case-insensitive dedupe with first-spelling
 * preservation, legacy participant fallback, and single `user` append.
 */

import { describe, expect, test } from 'vitest';

import { buildAvailableHandoffRoles } from './handoffRoles';

describe('buildAvailableHandoffRoles', () => {
  test('configured duo roles expose builder for planner even when only planner is present', () => {
    expect(
      buildAvailableHandoffRoles({
        teamRoles: ['planner', 'builder'],
        currentRole: 'planner',
        fallbackParticipantRoles: ['planner'],
      })
    ).toEqual(['builder', 'user']);
  });

  test('excludes the current role case-insensitively', () => {
    expect(
      buildAvailableHandoffRoles({
        teamRoles: ['PLANNER', 'builder'],
        currentRole: 'planner',
        fallbackParticipantRoles: [],
      })
    ).toEqual(['builder', 'user']);
    expect(
      buildAvailableHandoffRoles({
        teamRoles: ['planner', 'BUILDER'],
        currentRole: 'BUILDER',
        fallbackParticipantRoles: [],
      })
    ).toEqual(['planner', 'user']);
  });

  test('enhancer is not exposed unless explicitly eligible', () => {
    // Config includes enhancer but it is not eligible → omitted.
    expect(
      buildAvailableHandoffRoles({
        teamRoles: ['planner', 'enhancer', 'builder'],
        currentRole: 'planner',
        fallbackParticipantRoles: [],
      })
    ).toEqual(['builder', 'user']);

    // Eligible + configured enhancer present → included exactly once (configured position).
    expect(
      buildAvailableHandoffRoles({
        teamRoles: ['planner', 'enhancer', 'builder'],
        currentRole: 'planner',
        fallbackParticipantRoles: [],
        includeEnhancer: true,
      })
    ).toEqual(['enhancer', 'builder', 'user']);
  });

  test('eligible enhancer absent from membership is prepended exactly once', () => {
    expect(
      buildAvailableHandoffRoles({
        teamRoles: ['planner', 'builder'],
        currentRole: 'planner',
        fallbackParticipantRoles: [],
        includeEnhancer: true,
      })
    ).toEqual(['enhancer', 'builder', 'user']);
  });

  test('deduplicates case-insensitively and preserves the first configured spelling/order', () => {
    expect(
      buildAvailableHandoffRoles({
        teamRoles: ['Planner', 'BUILDER', 'builder'],
        currentRole: 'planner',
        fallbackParticipantRoles: [],
      })
    ).toEqual(['BUILDER', 'user']);
  });

  test('empty configured membership falls back to active participant roles', () => {
    expect(
      buildAvailableHandoffRoles({
        teamRoles: [],
        currentRole: 'planner',
        fallbackParticipantRoles: ['builder', 'enhancer'],
      })
    ).toEqual(['builder', 'user']);
  });

  test('appends user exactly once even when supplied in configuration or fallback', () => {
    expect(
      buildAvailableHandoffRoles({
        teamRoles: ['planner', 'builder', 'user'],
        currentRole: 'planner',
        fallbackParticipantRoles: [],
      })
    ).toEqual(['builder', 'user']);

    expect(
      buildAvailableHandoffRoles({
        teamRoles: [],
        currentRole: 'planner',
        fallbackParticipantRoles: ['builder', 'user', 'user'],
      })
    ).toEqual(['builder', 'user']);
  });
});
