/**
 * Minimal type declarations for `node:sqlite` (DatabaseSync).
 *
 * `@types/node@20` does not ship sqlite types (added in v22.5+). The daemon
 * runs on Node 24 where `node:sqlite` is available; this shim keeps the CLI
 * compiling with the pinned `@types/node`.
 */
declare module 'node:sqlite' {
  export interface DatabaseSyncOptions {
    readOnly?: boolean;
  }

  export class DatabaseSync {
    constructor(path: string, options?: DatabaseSyncOptions);
    exec(sql: string): void;
    prepare(sql: string): StatementSync;
    close(): void;
  }

  export interface StatementSync {
    run(...anonymousParameters: unknown[]): void;
    get(...anonymousParameters: unknown[]): Record<string, unknown> | undefined;
    all(...anonymousParameters: unknown[]): Record<string, unknown>[];
  }
}
