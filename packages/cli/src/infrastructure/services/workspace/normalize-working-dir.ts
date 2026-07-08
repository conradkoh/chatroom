/** Canonical workspace root path for registry lookups (matches backend + webapp). */
export function normalizeWorkingDirForLookup(workingDir: string): string {
  return workingDir.trim().replace(/[/\\]+$/, '');
}
