import type { ReactNode } from 'react';

export function LogsPageHeader({
  title = 'Session logs',
  actions,
}: {
  title?: string | undefined;
  actions?: ReactNode | undefined;
}) {
  return (
    <div className="flex items-center justify-between gap-4">
      <h2 className="text-lg font-medium tracking-tight">{title}</h2>
      {actions}
    </div>
  );
}
