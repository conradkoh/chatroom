import { describe, expect, test } from 'vitest';

import {
  compactFileTreeDeltaOperation,
  expandFileTreeDeltaOperation,
  expandFileTreeDeltaOperations,
  type CompactFileTreeDeltaOp,
  type VerboseFileTreeDeltaOp,
} from './fileTreeDeltaOps';

describe('compactFileTreeDeltaOperation', () => {
  test('compacts add operation with all fields', () => {
    const verbose: VerboseFileTreeDeltaOp = {
      operation: 'add',
      path: 'src/index.ts',
      entryType: 'file',
      size: 42,
      modifiedAt: 1_700_000_000_000,
    };
    const expected: CompactFileTreeDeltaOp = {
      o: 'a',
      p: 'src/index.ts',
      e: 'f',
      s: 42,
      m: 1_700_000_000_000,
    };
    expect(compactFileTreeDeltaOperation(verbose)).toEqual(expected);
  });

  test('compacts add operation without optional fields', () => {
    const verbose: VerboseFileTreeDeltaOp = {
      operation: 'add',
      path: 'src/index.ts',
      entryType: 'directory',
    };
    const expected: CompactFileTreeDeltaOp = {
      o: 'a',
      p: 'src/index.ts',
      e: 'd',
    };
    expect(compactFileTreeDeltaOperation(verbose)).toEqual(expected);
  });

  test('compacts remove operation', () => {
    const verbose: VerboseFileTreeDeltaOp = {
      operation: 'remove',
      path: 'old.ts',
    };
    const expected: CompactFileTreeDeltaOp = { o: 'r', p: 'old.ts' };
    expect(compactFileTreeDeltaOperation(verbose)).toEqual(expected);
  });

  test('compacts type-change operation', () => {
    const verbose: VerboseFileTreeDeltaOp = {
      operation: 'type-change',
      path: 'src',
      entryType: 'directory',
    };
    const expected: CompactFileTreeDeltaOp = { o: 't', p: 'src', e: 'd' };
    expect(compactFileTreeDeltaOperation(verbose)).toEqual(expected);
  });
});

describe('expandFileTreeDeltaOperation', () => {
  test('expands compact add with all fields', () => {
    const compact: CompactFileTreeDeltaOp = {
      o: 'a',
      p: 'src/index.ts',
      e: 'f',
      s: 42,
      m: 1_700_000_000_000,
    };
    const expected: VerboseFileTreeDeltaOp = {
      operation: 'add',
      path: 'src/index.ts',
      entryType: 'file',
      size: 42,
      modifiedAt: 1_700_000_000_000,
    };
    expect(expandFileTreeDeltaOperation(compact)).toEqual(expected);
  });

  test('expands compact add without optional fields', () => {
    const compact: CompactFileTreeDeltaOp = { o: 'a', p: 'dir', e: 'd' };
    const expected: VerboseFileTreeDeltaOp = {
      operation: 'add',
      path: 'dir',
      entryType: 'directory',
    };
    expect(expandFileTreeDeltaOperation(compact)).toEqual(expected);
  });

  test('expands compact remove', () => {
    const compact: CompactFileTreeDeltaOp = { o: 'r', p: 'old.ts' };
    const expected: VerboseFileTreeDeltaOp = { operation: 'remove', path: 'old.ts' };
    expect(expandFileTreeDeltaOperation(compact)).toEqual(expected);
  });

  test('expands compact type-change', () => {
    const compact: CompactFileTreeDeltaOp = { o: 't', p: 'src', e: 'f' };
    const expected: VerboseFileTreeDeltaOp = {
      operation: 'type-change',
      path: 'src',
      entryType: 'file',
    };
    expect(expandFileTreeDeltaOperation(compact)).toEqual(expected);
  });

  test('passes through legacy verbose operation', () => {
    const verbose: VerboseFileTreeDeltaOp = {
      operation: 'add',
      path: 'legacy.ts',
      entryType: 'file',
      size: 100,
    };
    expect(expandFileTreeDeltaOperation(verbose)).toBe(verbose);
  });
});

describe('expandFileTreeDeltaOperations', () => {
  test('expands array of mixed operations', () => {
    const ops: CompactFileTreeDeltaOp[] = [
      { o: 'a', p: 'new.ts', e: 'f' },
      { o: 'r', p: 'old.ts' },
    ];
    const expected: VerboseFileTreeDeltaOp[] = [
      { operation: 'add', path: 'new.ts', entryType: 'file' },
      { operation: 'remove', path: 'old.ts' },
    ];
    expect(expandFileTreeDeltaOperations(ops)).toEqual(expected);
  });
});
