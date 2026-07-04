/** Paths optimistically hidden from explorer before background delete confirms. */
export const pendingOptimisticDeletePaths = new Set<string>();

/** True if path is exactly pending or is a descendant of a pending directory delete. */
export function isPathPendingDelete(path: string): boolean {
  return [...pendingOptimisticDeletePaths].some(
    (pending) => path === pending || (pending !== '' && path.startsWith(`${pending}/`))
  );
}
