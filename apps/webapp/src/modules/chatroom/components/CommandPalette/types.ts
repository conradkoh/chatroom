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
   * without dismissing the dialog. Requires `script` to be set.
   */
  showOutputInline?: boolean;
  /**
   * The shell script to run for inline output commands.
   * Used by CommandPalette to call inlineCommand.run() when showOutputInline is true.
   */
  script?: string;
};

export type SettingsTab =
  | 'setup'
  | 'team'
  | 'machine'
  | 'agents'
  | 'workspaces'
  | 'skills'
  | 'integrations';
