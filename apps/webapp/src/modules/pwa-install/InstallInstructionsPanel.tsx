'use client';

import { Download } from 'lucide-react';

import type { InstallInstructions } from './types';
import { useAppDisplayName } from './useAppDisplayName';

import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';

export interface InstallInstructionsPanelProps {
  instructions: InstallInstructions;
  showNativeInstallButton?: boolean;
  onInstall?: () => void;
}

export function InstallInstructionsPanel({
  instructions,
  showNativeInstallButton = false,
  onInstall,
}: InstallInstructionsPanelProps) {
  const appName = useAppDisplayName();

  return (
    <div className="space-y-3">
      {instructions.note && (
        <Alert variant="default">
          <AlertDescription>{instructions.note}</AlertDescription>
        </Alert>
      )}
      <ol className="list-decimal space-y-1.5 pl-5 text-sm text-muted-foreground">
        {instructions.steps.map((step) => (
          <li key={step}>{step}</li>
        ))}
      </ol>
      {showNativeInstallButton && onInstall && (
        <Button onClick={onInstall} className="w-full">
          <Download className="mr-2 h-4 w-4" />
          Install {appName}
        </Button>
      )}
    </div>
  );
}
