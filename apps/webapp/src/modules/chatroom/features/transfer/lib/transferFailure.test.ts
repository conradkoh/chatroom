import { ChatroomTransferError } from '@workspace/backend/src/domain/entities/chatroom-transfer-file';
import { describe, expect, it } from 'vitest';

import { transferFailureOf } from './transferFailure';

describe('transferFailureOf', () => {
  it('keeps the code, message and details of a transfer error', () => {
    expect(
      transferFailureOf(
        new ChatroomTransferError('EXPORT_CHATROOM_CHANGED', 'changed', ['messages changed'])
      )
    ).toEqual({
      code: 'EXPORT_CHATROOM_CHANGED',
      message: 'changed',
      details: ['messages changed'],
    });
  });

  it('maps a Convex error payload', () => {
    expect(
      transferFailureOf({ data: { code: 'EXPORT_MACHINE_TOO_LARGE', message: 'too many' } })
    ).toEqual({ code: 'EXPORT_MACHINE_TOO_LARGE', message: 'too many', details: [] });
  });

  it('uses the fallback message when the Convex payload has no message', () => {
    expect(transferFailureOf({ data: { code: 'AUTH_FAILED' } })).toEqual({
      code: 'AUTH_FAILED',
      message: 'Could not complete the transfer. Try again.',
      details: [],
    });
  });

  it('maps anything else to UNKNOWN', () => {
    expect(transferFailureOf(new Error('boom'))).toEqual({
      code: 'UNKNOWN',
      message: 'Could not complete the transfer. Try again.',
      details: [],
    });
    expect(transferFailureOf('nope')).toEqual({
      code: 'UNKNOWN',
      message: 'Could not complete the transfer. Try again.',
      details: [],
    });
    expect(transferFailureOf({ data: { message: 'no code' } })).toEqual({
      code: 'UNKNOWN',
      message: 'Could not complete the transfer. Try again.',
      details: [],
    });
  });
});
