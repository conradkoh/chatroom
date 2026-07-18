'use client';

import { useVirtualizer } from '@tanstack/react-virtual';
import React, { useEffect, useRef } from 'react';

import { cn } from '@/lib/utils';

export interface VirtualizedScrollListProps<T> {
  items: T[];
  height: number;
  estimateSize: (index: number, item: T) => number;
  getItemKey: (index: number, item: T) => string;
  renderItem: (item: T, index: number) => React.ReactNode;
  className?: string;
  overscan?: number;
  listRef?: React.Ref<HTMLDivElement>;
  scrollToItemKey?: string;
}

export function VirtualizedScrollList<T>({
  items,
  height,
  estimateSize,
  getItemKey,
  renderItem,
  className,
  overscan = 8,
  listRef,
  scrollToItemKey,
}: VirtualizedScrollListProps<T>) {
  const parentRef = useRef<HTMLDivElement>(null);
  const prevScrollKeyRef = useRef<string | undefined>(undefined);
  const scrollToIndexRef = useRef<
    (index: number, opts?: { align?: 'auto' | 'start' | 'center' | 'end' }) => void
  >(() => {});
  const virtualizer = useVirtualizer({
    count: items.length,
    getScrollElement: () => parentRef.current,
    estimateSize: (index) => estimateSize(index, items[index]),
    getItemKey: (index) => getItemKey(index, items[index]),
    overscan,
  });
  scrollToIndexRef.current = virtualizer.scrollToIndex;

  useEffect(() => {
    if (!scrollToItemKey || scrollToItemKey === prevScrollKeyRef.current) return;
    const index = items.findIndex((item, i) => getItemKey(i, item) === scrollToItemKey);
    if (index < 0) return;
    prevScrollKeyRef.current = scrollToItemKey;
    scrollToIndexRef.current(index, { align: 'auto' });
  }, [scrollToItemKey, items, getItemKey]);

  const setRef = (el: HTMLDivElement | null) => {
    (parentRef as React.MutableRefObject<HTMLDivElement | null>).current = el;
    if (typeof listRef === 'function') {
      listRef(el);
    } else if (listRef && 'current' in listRef) {
      (listRef as React.MutableRefObject<HTMLDivElement | null>).current = el;
    }
  };

  return (
    <div ref={setRef} className={cn('overflow-y-auto', className)} style={{ height }}>
      <div style={{ height: virtualizer.getTotalSize(), position: 'relative', width: '100%' }}>
        {virtualizer.getVirtualItems().map((virtualRow) => {
          const item = items[virtualRow.index];
          return (
            <div
              key={virtualRow.key}
              data-index={virtualRow.index}
              style={{ position: 'absolute', top: virtualRow.start, left: 0, width: '100%' }}
            >
              {renderItem(item, virtualRow.index)}
            </div>
          );
        })}
      </div>
    </div>
  );
}
