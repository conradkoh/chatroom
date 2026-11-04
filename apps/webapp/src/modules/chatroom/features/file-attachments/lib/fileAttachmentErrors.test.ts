import { describe, expect, it } from 'vitest';

import { getFileAttachmentErrorMessage, isQuotaFieldError } from './fileAttachmentErrors';

describe('getFileAttachmentErrorMessage', () => {
  it('maps WEB_SESSION_REQUIRED', () => {
    expect(getFileAttachmentErrorMessage({ data: { code: 'WEB_SESSION_REQUIRED' } })).toBe(
      'Files can only be managed from the web app.'
    );
  });

  it('maps ACCESS_DENIED', () => {
    expect(getFileAttachmentErrorMessage({ data: { code: 'ACCESS_DENIED' } })).toBe(
      "You don't have access to these files."
    );
  });

  it('maps AUTH_FAILED', () => {
    expect(getFileAttachmentErrorMessage({ data: { code: 'AUTH_FAILED' } })).toBe(
      'Your session expired. Sign in again.'
    );
  });

  it('returns the server message for VALIDATION_ERROR', () => {
    expect(
      getFileAttachmentErrorMessage({
        data: { code: 'VALIDATION_ERROR', message: 'File is too large' },
      })
    ).toBe('File is too large');
  });

  it('falls back to a connectivity message for network failures', () => {
    expect(getFileAttachmentErrorMessage(new TypeError('Failed to fetch'))).toBe(
      "Couldn't reach the server. Check your connection and try again."
    );
  });

  it('falls back to a connectivity message for unknown errors', () => {
    expect(getFileAttachmentErrorMessage(new Error('boom'))).toBe(
      "Couldn't reach the server. Check your connection and try again."
    );
  });
});

describe('isQuotaFieldError', () => {
  it('is true for VALIDATION_ERROR mentioning quotaBytes', () => {
    expect(isQuotaFieldError({ data: { code: 'VALIDATION_ERROR', fields: ['quotaBytes'] } })).toBe(
      true
    );
  });

  it('is false for other validation errors', () => {
    expect(isQuotaFieldError({ data: { code: 'VALIDATION_ERROR', fields: ['filename'] } })).toBe(
      false
    );
  });

  it('is false for non-validation errors', () => {
    expect(isQuotaFieldError({ data: { code: 'ACCESS_DENIED', fields: ['quotaBytes'] } })).toBe(
      false
    );
  });
});
