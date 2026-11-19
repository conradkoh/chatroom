import { describe, expect, test } from 'vitest';

import { normalizeIntegrationDetail } from './integration-details';

describe('normalizeIntegrationDetail', () => {
  test('trims surrounding whitespace for name', () => {
    expect(normalizeIntegrationDetail('name', '  Ops  ')).toEqual({
      ok: true,
      value: 'Ops',
    });
  });

  test('treats empty and whitespace-only input as unset for both fields', () => {
    expect(normalizeIntegrationDetail('name', '')).toEqual({ ok: true, value: undefined });
    expect(normalizeIntegrationDetail('name', '   ')).toEqual({ ok: true, value: undefined });
    expect(normalizeIntegrationDetail('description', '')).toEqual({
      ok: true,
      value: undefined,
    });
    expect(normalizeIntegrationDetail('description', '   ')).toEqual({
      ok: true,
      value: undefined,
    });
  });

  test('accepts values at the maximum lengths', () => {
    const name = 'a'.repeat(80);
    const description = 'b'.repeat(500);
    expect(normalizeIntegrationDetail('name', name)).toEqual({ ok: true, value: name });
    expect(normalizeIntegrationDetail('description', description)).toEqual({
      ok: true,
      value: description,
    });
  });

  test('rejects names over 80 characters', () => {
    expect(normalizeIntegrationDetail('name', 'a'.repeat(81))).toMatchObject({
      ok: false,
      field: 'name',
      maxLength: 80,
      length: 81,
    });
  });

  test('rejects descriptions over 500 characters', () => {
    expect(normalizeIntegrationDetail('description', 'a'.repeat(501))).toMatchObject({
      ok: false,
      field: 'description',
      maxLength: 500,
      length: 501,
    });
  });

  test('measures length after trimming', () => {
    expect(normalizeIntegrationDetail('name', '  ' + 'a'.repeat(80) + '  ')).toEqual({
      ok: true,
      value: 'a'.repeat(80),
    });
    expect(normalizeIntegrationDetail('name', ' ' + 'a'.repeat(81))).toMatchObject({
      ok: false,
      field: 'name',
      length: 81,
    });
  });

  test('reports a human-readable message for over-limit names', () => {
    expect(normalizeIntegrationDetail('name', 'a'.repeat(81))).toMatchObject({
      message: 'Name must be 80 characters or fewer (got 81).',
    });
  });
});
