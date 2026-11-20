/**
 * Project root planning — unit tests.
 *
 * Pure path rules behind `addProjectRoot`: duplicate, nesting, sibling prefixes and
 * parent-collapse. Expected values are literals, not computed with the same helpers.
 */

import { describe, expect, test } from 'vitest';

import { isSameOrNestedPath, planRootAddition } from './project-root';

describe('isSameOrNestedPath', () => {
  test('treats an equal path as nested', () => {
    expect(isSameOrNestedPath('/a/foo', '/a/foo')).toBe(true);
  });

  test('treats a deeper path as nested', () => {
    expect(isSameOrNestedPath('/a/foo/bar', '/a/foo')).toBe(true);
  });

  test('does not treat a shared-prefix sibling as nested', () => {
    expect(isSameOrNestedPath('/a/foobar', '/a/foo')).toBe(false);
  });

  test('does not treat a shallower path as nested', () => {
    expect(isSameOrNestedPath('/a', '/a/foo')).toBe(false);
  });
});

describe('planRootAddition', () => {
  test('reports an exact duplicate', () => {
    expect(planRootAddition(['/Users/test/src'], '/Users/test/src')).toEqual({
      kind: 'duplicate',
    });
  });

  test('reports a candidate inside an existing root', () => {
    expect(planRootAddition(['/Users/test', '/Users/other'], '/Users/test/src')).toEqual({
      kind: 'nested_in_existing',
      parent: '/Users/test',
    });
  });

  test('accepts a sibling that only shares a string prefix', () => {
    expect(planRootAddition(['/Users/test/src'], '/Users/test/src-two')).toEqual({
      kind: 'add',
      collapse: [],
    });
  });

  test('accepts a parent and collapses several children, sorted', () => {
    expect(
      planRootAddition(
        ['/Users/test/src/b', '/Users/other', '/Users/test/src/a'],
        '/Users/test/src'
      )
    ).toEqual({
      kind: 'add',
      collapse: ['/Users/test/src/a', '/Users/test/src/b'],
    });
  });

  test('accepts an unrelated path with no collapse', () => {
    expect(planRootAddition(['/Users/test/src'], '/Users/other/repo')).toEqual({
      kind: 'add',
      collapse: [],
    });
  });

  test('accepts the first root on an empty machine', () => {
    expect(planRootAddition([], '/Users/test/src')).toEqual({ kind: 'add', collapse: [] });
  });
});
