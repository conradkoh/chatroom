import type React from 'react';

export type CommandItem = {
  id: string;
  label: string;
  icon?: React.ReactNode;
  category: string;
  shortcut?: string;
  keywords?: string[];
  action: () => void;
};
