import { describe, expect, it } from 'vitest';

import { buildHandoffNotificationContent } from './handoffNotificationContent';

describe('buildHandoffNotificationContent', () => {
  it('uses Chatroom | name title format', () => {
    expect(buildHandoffNotificationContent({ name: 'My Project', teamName: 'Duo' })).toEqual({
      title: 'Chatroom | My Project',
      body: 'Tasks complete',
    });
  });

  it('falls back to team name then Chatroom', () => {
    expect(buildHandoffNotificationContent({ name: undefined, teamName: 'Duo' }).title).toBe(
      'Chatroom | Duo'
    );
    expect(buildHandoffNotificationContent({}).title).toBe('Chatroom');
  });
});
