import { TEAM_PRESET_IDS } from '@workspace/shared/domain/team-kind';
import { TEAM_PRESETS } from '@workspace/shared/domain/team-presets';
import { describe, expect, test, vi } from 'vitest';

import { getTeam, listTeamPresets, setTeam } from './index.js';

function deps() {
  return {
    backend: {
      query: vi.fn(),
      mutation: vi.fn().mockResolvedValue(undefined),
    },
    session: { getSessionId: vi.fn().mockResolvedValue('session_1') },
  };
}

describe('team commands', () => {
  test('lists supported presets', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    await listTeamPresets();
    expect(log.mock.calls.join('\n')).toContain(
      'duo — Duo (planner, architect, researcher, triage, uiux-engineer, builder) entry: planner'
    );
    expect(log.mock.calls.join('\n')).toContain(
      'solo — Solo (solo, architect, triage, uiux-engineer) entry: solo'
    );
    log.mockRestore();
  });

  test('lists every canonical role and entry point for each preset', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    await listTeamPresets();
    const output = log.mock.calls.join('\n');
    for (const teamId of TEAM_PRESET_IDS) {
      const preset = TEAM_PRESETS[teamId];
      expect(output).toContain(
        `${teamId} — ${preset.name} (${preset.roles.join(', ')}) entry: ${preset.entryPoint}`
      );
    }
    log.mockRestore();
  });

  test('gets the current team from the backend', async () => {
    const d = deps();
    d.backend.query.mockResolvedValue({
      teamId: 'solo',
      teamName: 'Solo',
      teamRoles: ['solo'],
      teamEntryPoint: 'solo',
    });
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    await getTeam('room_1', d);
    expect(d.backend.query).toHaveBeenCalled();
    expect(log.mock.calls.join('\n')).toContain('Current team: solo (Solo)');
    log.mockRestore();
  });

  test('sets a valid team preset', async () => {
    const d = deps();
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    await setTeam('room_1', 'solo', d);
    expect(d.backend.mutation).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        sessionId: 'session_1',
        chatroomId: 'room_1',
        teamStructureId: 'solo',
      })
    );
    log.mockRestore();
  });

  test('rejects unknown team preset before backend access', async () => {
    const d = deps();
    await expect(setTeam('room_1', 'unknown', d)).rejects.toThrow('Unknown team preset');
    expect(d.backend.mutation).not.toHaveBeenCalled();
  });
});
