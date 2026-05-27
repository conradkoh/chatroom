/**
 * Local replacement for the ambient `NodeJS.ErrnoException` global.
 * Models the extra fields Node sets on errors thrown by `node:fs`,
 * `node:net`, etc. Use instead of `NodeJS.ErrnoException`.
 */
export type NodeError = Error & {
  code?: string;
  errno?: number;
  syscall?: string;
  path?: string;
};
