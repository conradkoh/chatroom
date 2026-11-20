import { ConvexError } from 'convex/values';
import { describe, expect, it } from 'vitest';

import { getConvexErrorCode, getMachineErrorCopy } from './machineErrorCopy';

const FALLBACK = 'Could not save the name. Try again.';

describe('getConvexErrorCode', () => {
  it('reads the code from an object payload', () => {
    expect(getConvexErrorCode(new ConvexError({ code: 'MACHINE_ONLINE' }))).toBe('MACHINE_ONLINE');
  });

  it('returns null for non-objects and payloads without a string code', () => {
    expect(getConvexErrorCode(undefined)).toBeNull();
    expect(getConvexErrorCode(null)).toBeNull();
    expect(getConvexErrorCode('MACHINE_ONLINE')).toBeNull();
    expect(getConvexErrorCode(new Error('boom'))).toBeNull();
    expect(getConvexErrorCode(new ConvexError({ code: 42 }))).toBeNull();
    expect(getConvexErrorCode(new ConvexError('plain string'))).toBeNull();
  });
});

describe('getMachineErrorCopy', () => {
  it('maps NOT_AUTHORIZED_MACHINE', () => {
    const error = new ConvexError({ code: 'NOT_AUTHORIZED_MACHINE', message: 'raw' });
    expect(getMachineErrorCopy(error, FALLBACK)).toBe("You don't have access to this machine.");
  });

  it('maps MACHINE_NOT_FOUND', () => {
    const error = new ConvexError({ code: 'MACHINE_NOT_FOUND', message: 'raw' });
    expect(getMachineErrorCopy(error, FALLBACK)).toBe('This machine no longer exists.');
  });

  it('maps MACHINE_ONLINE', () => {
    const error = new ConvexError({ code: 'MACHINE_ONLINE', message: 'raw' });
    expect(getMachineErrorCopy(error, FALLBACK)).toBe(
      'This machine is online. Stop the daemon and try again.'
    );
  });

  it('uses the payload message for an unknown code', () => {
    const error = new ConvexError({ code: 'SOMETHING_ELSE', message: 'Alias is too long' });
    expect(getMachineErrorCopy(error, FALLBACK)).toBe('Alias is too long');
  });

  it('uses a string payload', () => {
    expect(getMachineErrorCopy(new ConvexError('Alias is invalid'), FALLBACK)).toBe(
      'Alias is invalid'
    );
  });

  it('never leaks a plain Error message', () => {
    expect(
      getMachineErrorCopy(new Error('[CONVEX M(machines:setMachineAlias)] noisy'), FALLBACK)
    ).toBe(FALLBACK);
  });

  it('falls back for non-error values', () => {
    expect(getMachineErrorCopy(undefined, FALLBACK)).toBe(FALLBACK);
    expect(getMachineErrorCopy(null, FALLBACK)).toBe(FALLBACK);
    expect(getMachineErrorCopy('nope', FALLBACK)).toBe(FALLBACK);
    expect(getMachineErrorCopy({ data: { message: '' } }, FALLBACK)).toBe(FALLBACK);
  });
});
