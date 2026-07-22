import { describe, expect, it } from 'vitest';

import { formatAuthLoginCommand } from './cli-command-formatting.js';

const PRODUCTION_URL = 'https://chatroom-cloud.duskfare.com';
const LOCAL_CONVEX_URL = 'http://127.0.0.1:3210';
const LOCAL_WEB_URL = 'http://localhost:6249';

describe('formatAuthLoginCommand', () => {
  it('returns bare command for production Convex URL', () => {
    expect(formatAuthLoginCommand(PRODUCTION_URL, {})).toBe('chatroom auth login');
  });

  it('includes CHATROOM_CONVEX_URL for non-production without web URL', () => {
    expect(formatAuthLoginCommand(LOCAL_CONVEX_URL, {})).toBe(
      `CHATROOM_CONVEX_URL=${LOCAL_CONVEX_URL} chatroom auth login`
    );
  });

  it('includes both env vars when CHATROOM_WEB_URL is set', () => {
    const cmd = formatAuthLoginCommand(LOCAL_CONVEX_URL, {
      CHATROOM_WEB_URL: LOCAL_WEB_URL,
    });
    expect(cmd).toBe(
      `CHATROOM_WEB_URL=${LOCAL_WEB_URL} CHATROOM_CONVEX_URL=${LOCAL_CONVEX_URL} chatroom auth login`
    );
  });
});
