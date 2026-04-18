import type React from 'react';

export type CommandItemSecondaryAction = {
  id: string;
  label: string;
  icon?: React.ReactNode;
  action: () => void;
};

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
  /** Optional secondary action buttons rendered at the end of the item row */
  secondaryActions?: CommandItemSecondaryAction[];
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
