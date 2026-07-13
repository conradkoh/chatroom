import { describe, expect, it } from 'vitest';

import { buildHandoffNotificationContent } from './handoffNotificationContent';

describe('buildHandoffNotificationContent', () => {
  it('uses chatroom name in title', () => {
    expect(buildHandoffNotificationContent({ name: 'My Project', teamName: 'Duo' })).toEqual({
      title: 'My Project Handoff',
      body: 'Tasks complete.',
    });
  });

  it('falls back to team name then Handoff', () => {
    expect(buildHandoffNotificationContent({ name: undefined, teamName: 'Duo' }).title).toBe(
      'Duo Handoff'
    );
    expect(buildHandoffNotificationContent({}).title).toBe('Handoff');
  });
});
