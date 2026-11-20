import { beforeEach, expect, test, vi } from 'vitest';

import { t } from '../test.setup';
import { api } from './_generated/api';

const mockAllowedSignupMethods = vi.hoisted(() => ({
  value: ['self'] as string[] | null,
}));

vi.mock('../config/featureFlags', () => ({
  featureFlags: {
    disableLogin: false,
    get allowedSignupMethods() {
      return mockAllowedSignupMethods.value;
    },
  },
}));

beforeEach(() => {
  mockAllowedSignupMethods.value = ['self'];
});

test('appinfo.get returns self as the allowed signup method by default', async () => {
  const info = await t.query(api.appinfo.get, {});
  expect(info.allowedSignupMethods).toEqual(['self']);
});

test('appinfo.get returns invite only when only invite is configured', async () => {
  mockAllowedSignupMethods.value = ['invite'];
  const info = await t.query(api.appinfo.get, {});
  expect(info.allowedSignupMethods).toEqual(['invite']);
});

test('appinfo.get returns both methods when self and invite are configured', async () => {
  mockAllowedSignupMethods.value = ['self', 'invite'];
  const info = await t.query(api.appinfo.get, {});
  expect(info.allowedSignupMethods).toEqual(['self', 'invite']);
});

test('appinfo.get returns an empty array when the flag is null (sign-ups closed)', async () => {
  mockAllowedSignupMethods.value = null;
  const info = await t.query(api.appinfo.get, {});
  expect(info.allowedSignupMethods).toEqual([]);
});

test('appinfo.get drops unknown signup method values', async () => {
  mockAllowedSignupMethods.value = ['self', 'waitlist'];
  const info = await t.query(api.appinfo.get, {});
  expect(info.allowedSignupMethods).toEqual(['self']);
});

test('appinfo.get keeps existing fields unchanged', async () => {
  const info = await t.query(api.appinfo.get, {});
  expect(info).toEqual({
    version: '1.0.0',
    googleAuthAvailable: false,
    googleAuthDetails: {
      isConfiguredInDatabase: false,
      isEnabled: false,
      hasClientId: false,
      hasClientSecret: false,
    },
    allowedSignupMethods: ['self'],
  });
});
