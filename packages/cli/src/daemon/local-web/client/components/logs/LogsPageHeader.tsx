import type { ReactNode } from 'react';

export function LogsPageHeader({ actions }: { actions?: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <h2 className="text-lg font-medium tracking-tight">Session logs</h2>
      {actions}
    </div>
  );
}
