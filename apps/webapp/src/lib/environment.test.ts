import { afterEach, describe, expect, it, vi } from 'vitest';
import { isLocalEnvironment, getAppTitle, getDaemonStartCommand, getAuthLoginCommand } from './environment';

const PRODUCTION_CONVEX_URL = 'https://chatroom-cloud.duskfare.com';
const LOCAL_CONVEX_URL = 'http://127.0.0.1:3210';

describe('isLocalEnvironment', () => {
  afterEach(() => vi.unstubAllEnvs());

  it('returns false when NEXT_PUBLIC_CONVEX_URL is not set', () => {
    vi.stubEnv('NEXT_PUBLIC_CONVEX_URL', '');
    expect(isLocalEnvironment()).toBe(false);
  });

  it('returns false when NEXT_PUBLIC_CONVEX_URL is the production URL', () => {
    vi.stubEnv('NEXT_PUBLIC_CONVEX_URL', PRODUCTION_CONVEX_URL);
    expect(isLocalEnvironment()).toBe(false);
  });

  it('returns true when NEXT_PUBLIC_CONVEX_URL is a local URL', () => {
    vi.stubEnv('NEXT_PUBLIC_CONVEX_URL', LOCAL_CONVEX_URL);
    expect(isLocalEnvironment()).toBe(true);
  });
});

describe('getAppTitle', () => {
  afterEach(() => vi.unstubAllEnvs());

  it('returns base title for production', () => {
    vi.stubEnv('NEXT_PUBLIC_CONVEX_URL', PRODUCTION_CONVEX_URL);
    expect(getAppTitle('Chatroom')).toBe('Chatroom');
  });

  it('returns title with (Local) suffix for local env', () => {
    vi.stubEnv('NEXT_PUBLIC_CONVEX_URL', LOCAL_CONVEX_URL);
    expect(getAppTitle('Chatroom')).toBe('Chatroom (Local)');
  });

  it('uses default base title when none provided', () => {
    vi.stubEnv('NEXT_PUBLIC_CONVEX_URL', LOCAL_CONVEX_URL);
    expect(getAppTitle()).toBe('Chatroom (Local)');
  });
});

describe('getDaemonStartCommand', () => {
  afterEach(() => vi.unstubAllEnvs());

  it('returns bare command when NEXT_PUBLIC_CONVEX_URL is not set', () => {
    vi.stubEnv('NEXT_PUBLIC_CONVEX_URL', '');
    expect(getDaemonStartCommand()).toBe('chatroom machine daemon start');
  });

  it('returns bare command when NEXT_PUBLIC_CONVEX_URL is production', () => {
    vi.stubEnv('NEXT_PUBLIC_CONVEX_URL', PRODUCTION_CONVEX_URL);
    expect(getDaemonStartCommand()).toBe('chatroom machine daemon start');
  });

  it('returns prefixed command when NEXT_PUBLIC_CONVEX_URL is local', () => {
    vi.stubEnv('NEXT_PUBLIC_CONVEX_URL', LOCAL_CONVEX_URL);
    expect(getDaemonStartCommand()).toBe(
      `CHATROOM_CONVEX_URL=${LOCAL_CONVEX_URL} chatroom machine daemon start`
    );
  });
});

describe('getAuthLoginCommand', () => {
  afterEach(() => vi.unstubAllEnvs());

  it('returns bare command for production URL (webUrl ignored)', () => {
    vi.stubEnv('NEXT_PUBLIC_CONVEX_URL', PRODUCTION_CONVEX_URL);
    expect(getAuthLoginCommand('https://chatroom.example.com')).toBe('chatroom auth login');
  });

  it('returns prefixed command for local URL with webUrl', () => {
    vi.stubEnv('NEXT_PUBLIC_CONVEX_URL', LOCAL_CONVEX_URL);
    const cmd = getAuthLoginCommand('http://localhost:4000');
    expect(cmd).toContain('CHATROOM_WEB_URL=http://localhost:4000');
    expect(cmd).toContain(`CHATROOM_CONVEX_URL=${LOCAL_CONVEX_URL}`);
    expect(cmd).toContain('chatroom auth login');
  });

  it('throws when local environment and webUrl is empty', () => {
    vi.stubEnv('NEXT_PUBLIC_CONVEX_URL', LOCAL_CONVEX_URL);
    expect(() => getAuthLoginCommand('')).toThrow('webUrl is required');
  });

  it('returns bare command when NEXT_PUBLIC_CONVEX_URL is not set', () => {
    vi.stubEnv('NEXT_PUBLIC_CONVEX_URL', '');
    expect(getAuthLoginCommand('')).toBe('chatroom auth login');
  });
});
