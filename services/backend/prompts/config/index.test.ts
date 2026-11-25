import { describe, expect, test } from 'vitest';

import { getConfig } from './index';

const config = getConfig();

describe('getCliEnvPrefix', () => {
  test('returns no prefix for the production URL', () => {
    expect(config.getCliEnvPrefix('https://chatroom-cloud.duskfare.com')).toBe('');
  });

  test('returns no prefix when no URL is given', () => {
    expect(config.getCliEnvPrefix(undefined)).toBe('');
  });

  test('renders the prefix for a safe https URL', () => {
    expect(config.getCliEnvPrefix('https://preview.example.com')).toBe(
      'CHATROOM_CONVEX_URL=https://preview.example.com '
    );
  });

  test('renders the prefix for local http URLs with a port', () => {
    expect(config.getCliEnvPrefix('http://127.0.0.1:3210')).toBe(
      'CHATROOM_CONVEX_URL=http://127.0.0.1:3210 '
    );
    expect(config.getCliEnvPrefix('http://localhost:3210')).toBe(
      'CHATROOM_CONVEX_URL=http://localhost:3210 '
    );
  });

  test.each([
    'x; evil',
    'a b',
    'https://a.example`id`',
    'https://a.example/$(id)',
    'http://127.0.0.1:3210\nevil',
    'http://127.0.0.1:3210\n',
    '"https://a.example"',
    'https://a.example/$HOME',
  ])('returns no prefix for unsafe value %j', (unsafe) => {
    expect(config.getCliEnvPrefix(unsafe)).toBe('');
  });
});
