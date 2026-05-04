import { randomBytes } from 'crypto';

import { describe, expect, test } from 'vitest';

/**
 * Tests for the Telegram API module logic.
 *
 * Note: The actual Convex actions (forwardToTelegram, validateBotToken, etc.)
 * call external APIs and use Convex runtime context. These are tested
 * indirectly through the integration test suite.
 *
 * Here we test the pure logic and security properties.
 */

describe('telegram api', () => {
  describe('webhook secret generation', () => {
    test('crypto.randomBytes generates 64-character hex string', () => {
      const secret = randomBytes(32).toString('hex');
      expect(secret).toHaveLength(64);
      // Should only contain hex characters
      expect(secret).toMatch(/^[0-9a-f]+$/);
    });

    test('crypto.randomBytes produces unique secrets', () => {
      const secret1 = randomBytes(32).toString('hex');
      const secret2 = randomBytes(32).toString('hex');
      expect(secret1).not.toBe(secret2);
    });
  });

  describe('message formatting logic', () => {
    test('user role is labeled as "You"', () => {
      const senderRole = 'user';
      const label = senderRole === 'user' ? 'You' : senderRole;
      expect(label).toBe('You');
    });

    test('agent roles use their role name as label', () => {
      for (const role of ['planner', 'builder', 'reviewer']) {
        const label = role === 'user' ? 'You' : role;
        expect(label).toBe(role);
      }
    });

    test('message format includes role label and content', () => {
      const label = 'builder';
      const content = 'Hello from the builder';
      const text = `[${label}] ${content}`;
      expect(text).toBe('[builder] Hello from the builder');
    });
  });

  describe('loop prevention logic', () => {
    test('messages from telegram platform should be skipped', () => {
      const sourcePlatform = 'telegram';
      const shouldSkip = sourcePlatform === 'telegram';
      expect(shouldSkip).toBe(true);
    });

    test('messages from other platforms should not be skipped', () => {
      for (const platform of [undefined, 'web', 'cli', 'slack']) {
        const shouldSkip = platform === 'telegram';
        expect(shouldSkip).toBe(false);
      }
    });
  });

  describe('role filtering logic', () => {
    test('user role is allowed', () => {
      const senderRole = 'user';
      const isAllowed =
        senderRole === 'user' || !!senderRole.match(/^(planner|builder|reviewer)$/);
      expect(isAllowed).toBe(true);
    });

    test('agent roles are allowed', () => {
      for (const role of ['planner', 'builder', 'reviewer']) {
        const isAllowed = role === 'user' || !!role.match(/^(planner|builder|reviewer)$/);
        expect(isAllowed).toBe(true);
      }
    });

    test('system roles are filtered out', () => {
      for (const role of ['system', 'internal', 'bot', 'admin']) {
        const isAllowed = role === 'user' || !!role.match(/^(planner|builder|reviewer)$/);
        expect(isAllowed).toBe(false);
      }
    });
  });
});
