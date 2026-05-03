'use client';

import type { Id } from '@workspace/backend/convex/_generated/dataModel';
import { RefreshCw } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { useRefreshCapabilities } from '../hooks/useRefreshCapabilities';

interface CapabilitiesRefreshButtonProps {
  workspaceId: Id<'chatroom_workspaces'>;
  /** Controls button and icon dimensions. Defaults to 'icon'. */
  size?: 'icon' | 'sm';
}

/**
 * Ghost icon-button that triggers a capability refresh for the given workspace.
 * Spins the RefreshCw icon while the mutation is in-flight and disables itself.
 */
export function CapabilitiesRefreshButton({
  workspaceId,
  size = 'icon',
}: CapabilitiesRefreshButtonProps) {
  const { refresh, isRefreshing } = useRefreshCapabilities();

  const isSm = size === 'sm';
  const buttonClass = isSm
    ? 'h-6 w-6 text-muted-foreground hover:text-foreground hover:bg-accent/50'
    : 'h-7 w-7 text-muted-foreground hover:text-foreground hover:bg-accent/50';
  const iconSize = isSm ? 11 : 13;

  return (
    <Button
      size="icon"
      variant="ghost"
      className={buttonClass}
      onClick={() => refresh(workspaceId)}
      disabled={isRefreshing}
      aria-label="Refresh capabilities"
      title="Refresh capabilities"
    >
      <RefreshCw size={iconSize} className={isRefreshing ? 'animate-spin' : ''} />
    </Button>
  );
}
