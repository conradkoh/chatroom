'use client';

import { ChevronDown } from 'lucide-react';

import { getInstructionsForPlatform } from './installInstructions';
import { InstallInstructionsPanel } from './InstallInstructionsPanel';
import { useAppDisplayName } from './useAppDisplayName';
import { usePwaInstall } from './usePwaInstall';

import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';

/**
 * Mobile-only collapsible install banner shown below the nav header.
 * Hidden when running as an installed PWA or before client detection completes.
 */
export function InstallAppMobileBanner() {
  const { platform, isInstalled, canNativeInstall, isReady, promptInstall } = usePwaInstall();
  const appName = useAppDisplayName();

  if (!isReady || isInstalled || platform === 'already-installed') {
    return null;
  }

  const instructions = getInstructionsForPlatform(
    platform as Exclude<typeof platform, 'already-installed'>,
    appName
  );

  return (
    <div className="md:hidden">
      <Collapsible defaultOpen={false} className="border-b bg-background">
        <CollapsibleTrigger className="flex w-full items-center justify-between px-4 py-3 text-sm font-medium text-foreground">
          Install App
          <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground transition-transform ui-open:rotate-180" />
        </CollapsibleTrigger>
        <CollapsibleContent className="px-4 pb-3">
          <InstallInstructionsPanel
            instructions={instructions}
            showNativeInstallButton={canNativeInstall}
            onInstall={promptInstall}
          />
        </CollapsibleContent>
      </Collapsible>
    </div>
  );
}
