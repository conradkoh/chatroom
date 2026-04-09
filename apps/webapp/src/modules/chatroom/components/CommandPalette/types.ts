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
};

export type SettingsTab = 'setup' | 'team' | 'machine' | 'agents' | 'workspaces' | 'integrations';
