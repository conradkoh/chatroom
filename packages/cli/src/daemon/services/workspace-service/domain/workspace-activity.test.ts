import { describe, expect, it } from 'vitest';

import { activeWorkingDirs, diffMembership } from './workspace-activity.js';
import type { AgentWorkspacePresence } from '../../agent-process-service/domain/entities/agent-process.js';

function presence(workingDir: string, role = 'builder'): AgentWorkspacePresence {
  return { chatroomId: 'chatroom-1', role, workingDir };
}

describe('activeWorkingDirs', () => {
  it('returns an empty set when there are no presences', () => {
    expect(activeWorkingDirs([])).toEqual(new Set());
  });

  it('normalizes a trailing slash so it matches the bare directory', () => {
    expect(activeWorkingDirs([presence('/repo/app/')])).toEqual(new Set(['/repo/app']));
  });

  it('normalizes surrounding whitespace and trailing backslashes', () => {
    expect(activeWorkingDirs([presence('  /repo/app\\\\ ')])).toEqual(new Set(['/repo/app']));
  });

  it('counts two presences in one directory once', () => {
    const result = activeWorkingDirs([
      presence('/repo/app', 'builder'),
      presence('/repo/app', 'reviewer'),
    ]);

    expect(result).toEqual(new Set(['/repo/app']));
    expect(result.size).toBe(1);
  });

  it('includes every directory that has a presence', () => {
    expect(activeWorkingDirs([presence('/repo/a'), presence('/repo/b')])).toEqual(
      new Set(['/repo/a', '/repo/b'])
    );
  });
});

describe('diffMembership', () => {
  it('reports directories that are new relative to the current membership', () => {
    expect(diffMembership(['/repo/a'], ['/repo/a', '/repo/b'])).toEqual({
      added: ['/repo/b'],
      removed: [],
    });
  });

  it('reports directories that are no longer in the next membership', () => {
    expect(diffMembership(['/repo/a', '/repo/b'], ['/repo/a'])).toEqual({
      added: [],
      removed: ['/repo/b'],
    });
  });

  it('dedupes duplicates in next and normalizes them before comparing', () => {
    expect(diffMembership([], ['/repo/a/', '/repo/a', '/repo/a '])).toEqual({
      added: ['/repo/a'],
      removed: [],
    });
  });

  it('returns empty added and removed for an unchanged membership', () => {
    expect(diffMembership(['/repo/a', '/repo/b'], ['/repo/b/', '/repo/a'])).toEqual({
      added: [],
      removed: [],
    });
  });
});
