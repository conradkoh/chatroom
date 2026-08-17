export function validateFileTreeRevision(revision: number, field: string): void {
  if (!Number.isSafeInteger(revision) || revision < 0)
    throw new Error(`${field} must be a non-negative safe integer`);
}
