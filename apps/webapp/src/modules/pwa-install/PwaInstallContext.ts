'use client';

import { createContext } from 'react';

import type { InstallPlatform } from './types';

export interface PwaInstallContextValue {
  platform: InstallPlatform;
  isInstalled: boolean;
  canNativeInstall: boolean;
  isReady: boolean;
  dialogOpen: boolean;
  setDialogOpen: (open: boolean) => void;
  promptInstall: () => Promise<void>;
}

export const PwaInstallContext = createContext<PwaInstallContextValue | null>(null);
