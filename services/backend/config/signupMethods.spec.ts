import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  getAllowedSignupMethods,
  getSignupConfigLabel,
  isInviteSignupAllowed,
  isSelfSignupAllowed,
  isSignupAllowed,
  SignupMethod,
} from './signupMethods';

const mockAllowedSignupMethods = vi.hoisted(() => ({
  value: ['self'] as string[] | null,
}));

vi.mock('./featureFlags', () => ({
  featureFlags: {
    get allowedSignupMethods() {
      return mockAllowedSignupMethods.value;
    },
  },
}));

describe('getAllowedSignupMethods', () => {
  beforeEach(() => {
    mockAllowedSignupMethods.value = ['self'];
  });

  it('returns empty array when allowedSignupMethods is null', () => {
    mockAllowedSignupMethods.value = null;
    expect(getAllowedSignupMethods()).toEqual([]);
  });

  it('returns empty array when allowedSignupMethods is empty', () => {
    mockAllowedSignupMethods.value = [];
    expect(getAllowedSignupMethods()).toEqual([]);
  });

  it('returns self when configured with self', () => {
    mockAllowedSignupMethods.value = ['self'];
    expect(getAllowedSignupMethods()).toEqual([SignupMethod.Self]);
  });

  it('filters out unknown signup method values', () => {
    mockAllowedSignupMethods.value = ['self', 'waitlist', 'invite'];
    expect(getAllowedSignupMethods()).toEqual([SignupMethod.Self, SignupMethod.Invite]);
  });
});

describe('signup method helpers', () => {
  beforeEach(() => {
    mockAllowedSignupMethods.value = ['self'];
  });

  it('isSignupAllowed is false when no methods are configured', () => {
    mockAllowedSignupMethods.value = null;
    expect(isSignupAllowed()).toBe(false);
    mockAllowedSignupMethods.value = [];
    expect(isSignupAllowed()).toBe(false);
  });

  it('isSelfSignupAllowed is true when self is allowed', () => {
    mockAllowedSignupMethods.value = ['self'];
    expect(isSelfSignupAllowed()).toBe(true);
    expect(isInviteSignupAllowed()).toBe(false);
  });

  it('isInviteSignupAllowed is true when invite is allowed', () => {
    mockAllowedSignupMethods.value = ['invite'];
    expect(isInviteSignupAllowed()).toBe(true);
    expect(isSelfSignupAllowed()).toBe(false);
  });
});

describe('getSignupConfigLabel', () => {
  beforeEach(() => {
    mockAllowedSignupMethods.value = ['self'];
  });

  it('returns Disabled when allowedSignupMethods is null or empty', () => {
    mockAllowedSignupMethods.value = null;
    expect(getSignupConfigLabel()).toBe('Disabled');
    mockAllowedSignupMethods.value = [];
    expect(getSignupConfigLabel()).toBe('Disabled');
  });

  it('returns Open (self) when only self is allowed', () => {
    mockAllowedSignupMethods.value = ['self'];
    expect(getSignupConfigLabel()).toBe('Open (self)');
  });

  it('returns Invite only when only invite is allowed', () => {
    mockAllowedSignupMethods.value = ['invite'];
    expect(getSignupConfigLabel()).toBe('Invite only');
  });

  it('returns Self + Invite when both are allowed', () => {
    mockAllowedSignupMethods.value = ['self', 'invite'];
    expect(getSignupConfigLabel()).toBe('Self + Invite');
  });
});
