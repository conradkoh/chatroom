'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';

import { detectInstallPlatform } from './detectInstallPlatform';
import { InstallAppDialog } from './InstallAppDialog';
import { isStandaloneMode } from './isStandalone';
import { PwaInstallContext, type PwaInstallContextValue } from './PwaInstallContext';
import type { BeforeInstallPromptEvent, InstallPlatform } from './types';

export function PwaInstallProvider({ children }: { children: React.ReactNode }) {
  const [platform, setPlatform] = useState<InstallPlatform>('desktop-other');
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [isReady, setIsReady] = useState(false);

  useEffect(() => {
    const detected = detectInstallPlatform({
      userAgent: navigator.userAgent,
      platform: navigator.platform,
      maxTouchPoints: navigator.maxTouchPoints,
      isStandalone: isStandaloneMode(),
    });
    setPlatform(detected);
    setIsReady(true);

    const onBeforeInstallPrompt = (event: Event) => {
      event.preventDefault();
      setDeferredPrompt(event as BeforeInstallPromptEvent);
    };

    window.addEventListener('beforeinstallprompt', onBeforeInstallPrompt);
    return () => window.removeEventListener('beforeinstallprompt', onBeforeInstallPrompt);
  }, []);

  const promptInstall = useCallback(async () => {
    if (!deferredPrompt) return;
    await deferredPrompt.prompt();
    await deferredPrompt.userChoice;
    setDeferredPrompt(null);
  }, [deferredPrompt]);

  const isInstalled = platform === 'already-installed';

  const value = useMemo<PwaInstallContextValue>(
    () => ({
      platform,
      isInstalled,
      canNativeInstall: deferredPrompt !== null,
      isReady,
      dialogOpen,
      setDialogOpen,
      promptInstall,
    }),
    [platform, isInstalled, deferredPrompt, isReady, dialogOpen, promptInstall]
  );

  return (
    <PwaInstallContext.Provider value={value}>
      {children}
      <InstallAppDialog />
    </PwaInstallContext.Provider>
  );
}
