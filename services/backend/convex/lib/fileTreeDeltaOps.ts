import { v } from 'convex/values';

export const compactFileTreeDeltaOperationValidator = v.union(
  v.object({
    o: v.literal('a'),
    p: v.string(),
    e: v.union(v.literal('f'), v.literal('d')),
    s: v.optional(v.number()),
    m: v.optional(v.number()),
  }),
  v.object({
    o: v.literal('r'),
    p: v.string(),
  }),
  v.object({
    o: v.literal('t'),
    p: v.string(),
    e: v.union(v.literal('f'), v.literal('d')),
  })
);

export type CompactFileTreeDeltaOp =
  | { o: 'a'; p: string; e: 'f' | 'd'; s?: number; m?: number }
  | { o: 'r'; p: string }
  | { o: 't'; p: string; e: 'f' | 'd' };

export type VerboseFileTreeDeltaOp =
  | {
      operation: 'add';
      path: string;
      entryType: 'file' | 'directory';
      size?: number;
      modifiedAt?: number;
    }
  | { operation: 'remove'; path: string }
  | { operation: 'type-change'; path: string; entryType: 'file' | 'directory' };

export function compactFileTreeDeltaOperation(op: VerboseFileTreeDeltaOp): CompactFileTreeDeltaOp {
  if (op.operation === 'remove') return { o: 'r', p: op.path };
  const e = op.entryType === 'directory' ? 'd' : 'f';
  if (op.operation === 'add') {
    return {
      o: 'a',
      p: op.path,
      e,
      ...(op.size !== undefined ? { s: op.size } : {}),
      ...(op.modifiedAt !== undefined ? { m: op.modifiedAt } : {}),
    };
  }
  return { o: 't', p: op.path, e };
}

export function expandFileTreeDeltaOperation(
  op: CompactFileTreeDeltaOp | VerboseFileTreeDeltaOp
): VerboseFileTreeDeltaOp {
  if ('operation' in op) return op;
  if (op.o === 'r') return { operation: 'remove', path: op.p };
  const entryType = op.e === 'd' ? 'directory' : 'file';
  if (op.o === 'a') {
    return {
      operation: 'add',
      path: op.p,
      entryType,
      ...(op.s !== undefined ? { size: op.s } : {}),
      ...(op.m !== undefined ? { modifiedAt: op.m } : {}),
    };
  }
  return { operation: 'type-change', path: op.p, entryType };
}

export function expandFileTreeDeltaOperations(
  ops: (CompactFileTreeDeltaOp | VerboseFileTreeDeltaOp)[]
): VerboseFileTreeDeltaOp[] {
  return ops.map(expandFileTreeDeltaOperation);
}
