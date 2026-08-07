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

export const verboseFileTreeDeltaOperationValidator = v.union(
  v.object({
    operation: v.literal('add'),
    path: v.string(),
    entryType: v.optional(v.union(v.literal('file'), v.literal('directory'))),
    size: v.optional(v.number()),
    modifiedAt: v.optional(v.number()),
  }),
  v.object({
    operation: v.literal('remove'),
    path: v.string(),
  }),
  v.object({
    operation: v.literal('type-change'),
    path: v.string(),
    entryType: v.union(v.literal('file'), v.literal('directory')),
  })
);

export const storedFileTreeDeltaOperationValidator = v.union(
  compactFileTreeDeltaOperationValidator,
  verboseFileTreeDeltaOperationValidator
);

export type StoredFileTreeDeltaOp =
  | CompactFileTreeDeltaOp
  | {
      operation: 'add';
      path: string;
      entryType?: 'file' | 'directory';
      size?: number;
      modifiedAt?: number;
    }
  | { operation: 'remove'; path: string }
  | { operation: 'type-change'; path: string; entryType: 'file' | 'directory' };

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

export function isVerboseFileTreeDeltaOp(
  op: StoredFileTreeDeltaOp
): op is StoredFileTreeDeltaOp & { operation: string } {
  return 'operation' in op;
}

// fallow-ignore-next-line complexity
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

// fallow-ignore-next-line complexity
function expandCompactFileTreeDeltaOp(op: CompactFileTreeDeltaOp): VerboseFileTreeDeltaOp {
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

// fallow-ignore-next-line complexity
function expandVerboseFileTreeDeltaOp(
  op: Extract<StoredFileTreeDeltaOp, { operation: string }>
): VerboseFileTreeDeltaOp {
  if (op.operation === 'remove') return { operation: 'remove', path: op.path };
  const entryType = op.entryType ?? 'file';
  if (op.operation === 'add') {
    return {
      operation: 'add',
      path: op.path,
      entryType,
      ...(op.size !== undefined ? { size: op.size } : {}),
      ...(op.modifiedAt !== undefined ? { modifiedAt: op.modifiedAt } : {}),
    };
  }
  return { operation: 'type-change', path: op.path, entryType };
}

export function expandFileTreeDeltaOperation(op: StoredFileTreeDeltaOp): VerboseFileTreeDeltaOp {
  if ('operation' in op) return expandVerboseFileTreeDeltaOp(op);
  return expandCompactFileTreeDeltaOp(op);
}

export function expandFileTreeDeltaOperations(
  ops: StoredFileTreeDeltaOp[]
): VerboseFileTreeDeltaOp[] {
  return ops.map(expandFileTreeDeltaOperation);
}
