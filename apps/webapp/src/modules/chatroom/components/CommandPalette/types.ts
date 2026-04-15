import type React from 'react';

export type CommandItem = {
  id: string;
  label: string;
  /** Optional detail line shown below the label (e.g. workspace hostname + path). */
  detail?: string;
  icon?: React.ReactNode;
  category: string;
  shortcut?: string;
  keywords?: string[];
  action: () => void;
  /**
   * If true, this command should show output inline in the command palette
   * without dismissing the dialog. The command must be a "runnable" command
   * that produces output.
   */
  showOutputInline?: boolean;
  /**
   * For runnable commands, provides a function to start the command and
   * returns a handle to control/stop the command.
   */
  runAction?: () => RunnableCommandHandle;
};

/** Handle returned by a runnable command to control its execution and stream output */
export interface RunnableCommandHandle {
  /** Stop the running command */
  stop: () => void;
  /** Subscribe to output updates */
  onOutput: (callback: (lines: string[]) => void) => () => void;
  /** Check if command is still running */
  isRunning: () => boolean;
}

export type SettingsTab = 'setup' | 'team' | 'machine' | 'agents' | 'workspaces' | 'integrations';
