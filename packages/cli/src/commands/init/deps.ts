/**
 * Init Deps — dependency interfaces for the init command.
 *
 * Applies interface segregation: the command declares exactly which
 * dependencies it needs, so tests only mock what's relevant.
 */

/** File system operations for project initialization */
export interface InitFsOps {
  access: (path: string) => Promise<void>;
  readFile: (path: string, encoding: BufferEncoding) => Promise<string>;
  writeFile: (path: string, content: string, encoding: BufferEncoding) => Promise<void>;
}

/**
 * All external dependencies for the init command.
 *
 * - `fs`: File system operations for reading and writing agent files
 */
export interface InitDeps {
  fs: InitFsOps;
}
