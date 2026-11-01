import { describe, expect, it } from 'vitest';

import { shallowEqualRecord, structurallyEqual } from './stableIdentity';

describe('shallowEqualRecord', () => {
  it('returns true for the same reference', () => {
    const value = { a: 1 };
    expect(shallowEqualRecord(value, value)).toBe(true);
  });

  it('returns true for equal own keys and false for a different value', () => {
    expect(shallowEqualRecord({ a: 1, b: 'x' }, { a: 1, b: 'x' })).toBe(true);
    expect(shallowEqualRecord({ a: 1 }, { a: 2 })).toBe(false);
  });

  it('returns false when the key sets differ', () => {
    expect(shallowEqualRecord({ a: 1 }, { a: 1, b: 2 })).toBe(false);
    expect(shallowEqualRecord({ a: 1, b: 2 }, { a: 1 })).toBe(false);
  });

  it('compares nested values by reference', () => {
    const nested = [1, 2];
    expect(shallowEqualRecord({ list: nested }, { list: nested })).toBe(true);
    expect(shallowEqualRecord({ list: [1, 2] }, { list: [1, 2] })).toBe(false);
  });
});

describe('structurallyEqual', () => {
  it('compares nested arrays element-wise', () => {
    expect(structurallyEqual({ list: [1, 2] }, { list: [1, 2] })).toBe(true);
    expect(structurallyEqual({ list: [1, 2] }, { list: [1, 3] })).toBe(false);
    expect(structurallyEqual({ list: [1, 2] }, { list: [1] })).toBe(false);
  });

  it('compares nested records and their key sets', () => {
    expect(structurallyEqual({ a: { b: 1 } }, { a: { b: 1 } })).toBe(true);
    expect(structurallyEqual({ a: { b: 1 } }, { a: { b: 1, c: 2 } })).toBe(false);
  });

  it('treats undefined and absent keys the same only when both are absent', () => {
    expect(structurallyEqual({ a: 1 }, { a: 1, b: undefined })).toBe(false);
  });

  it('does not treat non-plain values as equal', () => {
    expect(structurallyEqual(1, 2)).toBe(false);
    expect(structurallyEqual(null, {})).toBe(false);
  });
});
