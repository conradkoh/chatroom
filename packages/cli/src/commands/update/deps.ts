/**
 * Update Deps — dependency interfaces for the update command.
 *
 * The update command checks npm and runs install - it does not use
 * BackendOps or SessionOps. Uses getVersion and exec for testability.
 */

/**
 * Exec result from running a shell command
 */
export interface ExecResult {
  stdout: string;
  stderr?: string;
}

/**
 * All external dependencies for the update command.
 */
export interface UpdateDeps {
  getVersion: () => string;
  exec: (cmd: string) => Promise<ExecResult>;
}
