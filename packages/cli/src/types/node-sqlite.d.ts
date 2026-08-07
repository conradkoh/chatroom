declare module 'node:sqlite' {
  export interface StatementResult {
    lastInsertRowid: number | bigint;
    changes: number;
  }

  export interface StatementSync {
    run(...params: unknown[]): StatementResult;
    get(...params: unknown[]): unknown;
    all(...params: unknown[]): unknown[];
  }

  export class DatabaseSync {
    constructor(path: string);
    exec(sql: string): void;
    prepare(sql: string): StatementSync;
    close(): void;
  }
}
