'use client';

import { Button } from '@/components/ui/button';

export interface ConnectButtonProps {
  onClick: () => void;
  isLoading: boolean;
  isDisabled: boolean;
  className?: string;
  variant?: 'default' | 'outline' | 'secondary' | 'ghost' | 'link' | 'destructive';
}

/**
 * Generic connect button component for linking third-party accounts.
 */
export const ConnectButton = ({
  onClick,
  isLoading,
  isDisabled,
  className = '',
  variant = 'outline',
}: ConnectButtonProps) => {
  return (
    <Button
      variant={variant}
      onClick={onClick}
      disabled={isLoading || isDisabled}
      className={className}
    >
      {isLoading ? (
        <>
          <div className="mr-2 h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
          Connecting...
        </>
      ) : (
        'Connect'
      )}
    </Button>
  );
};
