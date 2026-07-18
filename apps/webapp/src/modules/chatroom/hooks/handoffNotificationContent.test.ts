import { describe, expect, it } from 'vitest';

import { buildHandoffNotificationContent } from './handoffNotificationContent';

describe('buildHandoffNotificationContent', () => {
  it('uses chatroom name as title', () => {
    expect(buildHandoffNotificationContent({ name: 'My Project', teamName: 'Duo' })).toEqual({
      title: 'My Project',
      body: 'Tasks complete',
    });
  });

  it('falls back to team name then Chatroom', () => {
    expect(buildHandoffNotificationContent({ name: undefined, teamName: 'Duo' }).title).toBe('Duo');
    expect(buildHandoffNotificationContent({}).title).toBe('Chatroom');
  });
});
