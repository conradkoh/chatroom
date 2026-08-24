'use client';

import { BoxSelect, Brush, Move } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

import { SKETCH_TOOLS, type SketchToolId } from './sketchTools';

import { cn } from '@/lib/utils';

const SKETCH_TOOL_ICONS: Record<SketchToolId, LucideIcon> = {
  move: Move,
  select: BoxSelect,
  brush: Brush,
};

export type SketchToolRailProps = {
  activeTool: SketchToolId;
  enabledTools: readonly SketchToolId[];
  disabled?: boolean;
  onToolChange: (tool: SketchToolId) => void;
};

export function SketchToolRail({
  activeTool,
  enabledTools,
  disabled,
  onToolChange,
}: SketchToolRailProps) {
  return (
    <div
      aria-label="Sketch tools"
      role="toolbar"
      className="hidden min-h-0 flex-col items-center gap-2 border-r-2 border-chatroom-border bg-chatroom-bg-secondary p-2 lg:flex"
    >
      {enabledTools.map((toolId) => {
        const tool = SKETCH_TOOLS[toolId];
        const Icon = SKETCH_TOOL_ICONS[toolId];
        return (
          <button
            key={toolId}
            type="button"
            aria-label={`${tool.label} tool`}
            aria-keyshortcuts={tool.shortcut}
            aria-pressed={toolId === activeTool}
            title={`${tool.label} tool (${tool.shortcut})`}
            disabled={disabled}
            onClick={() => onToolChange(toolId)}
            className={cn(
              'relative grid size-10 cursor-pointer place-items-center rounded-none border-2',
              toolId === activeTool
                ? 'border-chatroom-border-strong bg-chatroom-accent text-chatroom-bg-primary'
                : 'border-transparent text-chatroom-text-secondary hover:border-chatroom-border hover:bg-chatroom-bg-hover',
              'disabled:cursor-not-allowed disabled:opacity-40'
            )}
          >
            <Icon className="size-4" aria-hidden />
            <kbd aria-hidden className="absolute bottom-0.5 right-1 text-[8px] font-mono">
              {tool.shortcut}
            </kbd>
          </button>
        );
      })}
    </div>
  );
}
