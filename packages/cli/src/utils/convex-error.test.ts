/**
 * Unit tests for the getErrorMessage() utility function.
 *
 * Tests all ConvexError data shapes plus regular errors and non-error values.
 */

import { ConvexError } from 'convex/values';
import { describe, expect, it } from 'vitest';

import { getErrorMessage } from './convex-error.js';

describe('getErrorMessage', () => {
  describe('ConvexError with string data', () => {
    it('returns string data directly', () => {
      const error = new ConvexError('Backlog item not found');
      expect(getErrorMessage(error)).toBe('Backlog item not found');
    });

    it('returns empty string data', () => {
      const error = new ConvexError('');
      expect(getErrorMessage(error)).toBe('');
    });
  });

  describe('ConvexError with object data containing message', () => {
    it('returns data.message when present', () => {
      const error = new ConvexError({ code: 'NOT_FOUND', message: 'Item not found' });
      expect(getErrorMessage(error)).toBe('Item not found');
    });

    it('returns data.message even when code is present', () => {
      const error = new ConvexError({ code: 'FORBIDDEN', message: 'Access denied' });
      expect(getErrorMessage(error)).toBe('Access denied');
    });

    it('appends offending fields when data.fields is present', () => {
      const error = new ConvexError({
        code: 'BACKLOG_MISSING_REQUIRED_FIELD',
        message: 'Missing required fields',
        fields: ['content', 'priority'],
      });
      expect(getErrorMessage(error)).toBe(
        'Missing required fields\n  offending fields: content, priority'
      );
    });

    it('does not append fields when fields array is empty', () => {
      const error = new ConvexError({
        code: 'BACKLOG_MISSING_REQUIRED_FIELD',
        message: 'Missing required fields',
        fields: [],
      });
      expect(getErrorMessage(error)).toBe('Missing required fields');
    });
  });

  describe('ConvexError with object data containing code only', () => {
    it('returns data.code when message is absent', () => {
      const error = new ConvexError({ code: 'NOT_AUTHORIZED' });
      expect(getErrorMessage(error)).toBe('NOT_AUTHORIZED');
    });
  });

  describe('ConvexError with other data types', () => {
    it('falls back to String(data) for numeric data', () => {
      const error = new ConvexError(42);
      expect(getErrorMessage(error)).toBe('42');
    });

    it('falls back to String(data) for null data', () => {
      const error = new ConvexError(null);
      expect(getErrorMessage(error)).toBe('null');
    });
  });

  describe('regular Error', () => {
    it('returns message from regular Error', () => {
      const error = new Error('Something went wrong');
      expect(getErrorMessage(error)).toBe('Something went wrong');
    });

    it('returns message from TypeError', () => {
      const error = new TypeError('Cannot read property x of undefined');
      expect(getErrorMessage(error)).toBe('Cannot read property x of undefined');
    });

    it('appends diagnostic hint when message contains Server Error', () => {
      const error = new Error('[Request ID: abc123] Server Error');
      const result = getErrorMessage(error);
      expect(result).toContain('Server Error');
      expect(result).toContain('hint:');
      expect(result).toContain('arg-validator rejection');
      expect(result).toContain('version mismatch');
    });

    it('does not append hint for regular errors without Server Error', () => {
      const error = new Error('Not found');
      expect(getErrorMessage(error)).toBe('Not found');
      expect(getErrorMessage(error)).not.toContain('hint:');
    });
  });

  describe('non-Error values', () => {
    it('returns "null" for null', () => {
      expect(getErrorMessage(null)).toBe('null');
    });

    it('returns "undefined" for undefined', () => {
      expect(getErrorMessage(undefined)).toBe('undefined');
    });

    it('returns the string itself for string values', () => {
      expect(getErrorMessage('error string')).toBe('error string');
    });

    it('converts numbers to string', () => {
      expect(getErrorMessage(404)).toBe('404');
    });
  });
});
