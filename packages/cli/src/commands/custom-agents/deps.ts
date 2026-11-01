/**
 * Custom-agent command dependencies.
 *
 * The validate command is offline, so every side effect it needs is small and
 * injectable: the loader, the two directory sources, output, and the process
 * exit code. Tests supply real temporary directories and a captured stdout, so
 * they never touch the user's home directory or a real terminal.
 */

import type {
  LoadCustomAgentSourceInput,
  LoadedCustomAgentSource,
} from '../../infrastructure/services/custom-agents/index.js';

export interface CustomAgentsDeps {
  /** Source loader. Defaults to the real filesystem loader. */
  load: (input: LoadCustomAgentSourceInput) => Promise<LoadedCustomAgentSource>;
  /** Current working directory, used when no `--workspace` is given. */
  cwd: () => string;
  /** Home directory, used for the machine source. */
  homeDir: () => string;
  /** One line of command output. */
  stdout: (line: string) => void;
  /** Sets the process exit code without terminating early. */
  setExitCode: (code: number) => void;
}

/** What the user asked to validate. */
export interface ValidateCustomAgentsInput {
  /** `--workspace <dir>`; when absent the current directory is used. */
  workspaceDir?: string;
  /** `--machine`; validate `~/.chatroom/agents` as well as, or instead of, a workspace. */
  machine: boolean;
}
