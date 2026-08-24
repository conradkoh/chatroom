'use client';
import { Brush, Image } from 'lucide-react';

import type { SketchLayerMeta, SketchLayerId } from './sketchDocument';

import { cn } from '@/lib/utils';

export function SketchLayersPanel({
  layersTopFirst,
  activeLayerId,
  disabled,
  onActiveLayerChange,
  className,
}: {
  layersTopFirst: SketchLayerMeta[];
  activeLayerId: SketchLayerId;
  disabled: boolean;
  onActiveLayerChange: (id: SketchLayerId) => void;
  className?: string;
}) {
  return (
    <section
      aria-labelledby="sketch-layers-heading"
      className={cn('min-h-0 border-t-2 border-chatroom-border', className)}
    >
      <h3
        id="sketch-layers-heading"
        className="px-3 py-2 text-[10px] font-bold uppercase tracking-wider text-chatroom-text-muted lg:px-4"
      >
        Layers
      </h3>
      <div className="max-h-28 overflow-y-auto lg:max-h-none lg:flex-1">
        {layersTopFirst.map((layer) => {
          const Icon = layer.kind === 'pasted-image' ? Image : Brush;
          return (
            <button
              key={layer.id}
              type="button"
              aria-pressed={layer.id === activeLayerId}
              disabled={disabled}
              onClick={() => onActiveLayerChange(layer.id)}
              className={cn(
                'flex w-full cursor-pointer items-center gap-2 border-t border-chatroom-border px-3 py-2 text-left lg:px-4',
                layer.id === activeLayerId
                  ? 'bg-chatroom-bg-hover text-chatroom-text-primary'
                  : 'text-chatroom-text-secondary hover:bg-chatroom-bg-hover',
                'disabled:cursor-not-allowed disabled:opacity-40'
              )}
            >
              <Icon className="size-4 shrink-0" aria-hidden />
              <span className="min-w-0 flex-1 truncate text-xs font-medium">{layer.name}</span>
              {layer.id === activeLayerId ? <span className="sr-only">Active</span> : null}
            </button>
          );
        })}
      </div>
    </section>
  );
}
