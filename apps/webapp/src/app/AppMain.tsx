'use client';

import { ScrollableRegion } from '@/components/ScrollableRegion';

export function AppMain({ children }: { children: React.ReactNode }) {
  return (
    <ScrollableRegion
      as="main"
      regionId="root"
      className="flex min-h-0 flex-1 flex-col overflow-y-auto overscroll-y-contain"
    >
      {children}
    </ScrollableRegion>
  );
}
