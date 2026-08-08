import type { DragEvent } from 'react';

export function isOsFileDrag(event: DragEvent): boolean {
  return Array.from(event.dataTransfer.types).includes('Files');
}

export function shouldCommitOsFileDragLeave(
  event: DragEvent,
  currentTarget: EventTarget & Node
): boolean {
  const related = event.relatedTarget;
  return !(related instanceof Node && currentTarget.contains(related));
}

export function getFilesFromDrop(event: DragEvent): File[] {
  return Array.from(event.dataTransfer.files);
}
