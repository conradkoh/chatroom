export function isSketchDeleteShortcut(event: KeyboardEvent) {
  return event.key === 'Delete' || event.key === 'Backspace';
}

export function isEditableSketchTarget(target: EventTarget | null) {
  return (
    target instanceof HTMLElement &&
    (['INPUT', 'TEXTAREA'].includes(target.tagName) || target.isContentEditable)
  );
}
