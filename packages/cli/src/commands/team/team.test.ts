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
    expect(log.mock.calls.join('\n')).toContain('duo — Duo (planner, builder) entry: planner');
    expect(log.mock.calls.join('\n')).toContain('solo — Solo (solo) entry: solo');
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
        chatroomId: 'room_1',
        teamId: 'solo',
        teamRoles: ['solo'],
        teamEntryPoint: 'solo',
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
