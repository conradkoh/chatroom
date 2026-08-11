'use client';

import { useRef } from 'react';

import { useScrollRestoration } from '@/hooks/useScrollRestoration';
import { cn } from '@/lib/utils';

type ScrollableRegionProps = React.ComponentPropsWithoutRef<'div'> & {
  as?: 'div' | 'main';
  regionId?: string;
};

/**
 * Scrollable container that preserves scroll position on browser back/forward navigation.
 */
export function ScrollableRegion({
  as: Component = 'div',
  regionId = 'main',
  className,
  children,
  ...props
}: ScrollableRegionProps) {
  const ref = useRef<HTMLElement>(null);
  useScrollRestoration(ref, regionId);

  const commonProps = {
    className: cn(className),
    'data-scroll-region': true,
    ...props,
  };

  if (Component === 'main') {
    return (
      <main ref={ref as React.Ref<HTMLElement>} {...commonProps}>
        {children}
      </main>
    );
  }

  return (
    <div ref={ref as React.Ref<HTMLDivElement>} {...commonProps}>
      {children}
    </div>
  );
}
