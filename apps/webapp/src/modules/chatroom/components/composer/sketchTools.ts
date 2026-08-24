export type SketchToolId = 'move' | 'select' | 'brush' | 'eraser';

export const SKETCH_TOOLS = {
  move: { label: 'Move', shortcut: 'V' },
  select: { label: 'Select', shortcut: 'M' },
  brush: { label: 'Brush', shortcut: 'B' },
  eraser: { label: 'Eraser', shortcut: 'E' },
} as const satisfies Record<SketchToolId, { label: string; shortcut: string }>;

/** Enable a tool only after its pointer behavior and tests ship. */
export const SKETCH_ENABLED_TOOL_IDS = [
  'select',
  'brush',
  'eraser',
] as const satisfies readonly SketchToolId[];

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  return new Set(['INPUT', 'TEXTAREA', 'SELECT']).has(tag) || target.isContentEditable;
}

function hasShortcutModifier(
  event: Pick<KeyboardEvent, 'metaKey' | 'ctrlKey' | 'altKey' | 'shiftKey'>
): boolean {
  return event.metaKey || event.ctrlKey || event.altKey || event.shiftKey;
}

function isShortcutEligible(
  event: Pick<KeyboardEvent, 'metaKey' | 'ctrlKey' | 'altKey' | 'shiftKey'> & {
    target: EventTarget | null;
  }
): boolean {
  return !hasShortcutModifier(event) && !isEditableTarget(event.target);
}

function findToolForShortcut(key: string): SketchToolId | null {
  const match = (
    Object.entries(SKETCH_TOOLS) as [SketchToolId, (typeof SKETCH_TOOLS)[SketchToolId]][]
  ).find(([, tool]) => tool.shortcut === key);
  return match?.[0] ?? null;
}

export function resolveSketchToolShortcut(
  event: Pick<KeyboardEvent, 'key' | 'metaKey' | 'ctrlKey' | 'altKey' | 'shiftKey'> & {
    target: EventTarget | null;
  },
  enabledTools: readonly SketchToolId[]
): SketchToolId | null {
  if (!isShortcutEligible(event)) return null;
  const tool = findToolForShortcut(event.key.toUpperCase());
  return tool && enabledTools.includes(tool) ? tool : null;
}
