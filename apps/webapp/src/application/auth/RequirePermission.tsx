'use client';

import { ShieldX } from 'lucide-react';
import type { ReactNode } from 'react';

import type { Permission } from './permissions';

import { Card } from '@/components/ui/card';
import { useAuthState } from '@/modules/auth/AuthProvider';

export interface RequirePermissionProps {
  permission: Permission;
  children: ReactNode;
  fallback?: ReactNode;
}

/**
 * Renders children only when the authenticated user has the required permission.
 */
// fallow-ignore-next-line complexity
export function RequirePermission({ permission, children, fallback }: RequirePermissionProps) {
  const authState = useAuthState();
  const allowed =
    authState?.state === 'authenticated' && authState.permissions.includes(permission);

  if (!allowed) {
    return fallback ?? _defaultFallback(permission);
  }

  return <>{children}</>;
}

function _defaultFallback(permission: Permission) {
  return (
    <div className="flex min-h-[12rem] items-center justify-center p-4">
      <Card className="max-w-md p-6 text-center">
        <ShieldX className="mx-auto mb-3 h-10 w-10 text-destructive/60" />
        <p className="text-sm text-muted-foreground">
          You do not have permission:{' '}
          <span className="font-medium text-foreground">{permission}</span>
        </p>
      </Card>
    </div>
  );
}
