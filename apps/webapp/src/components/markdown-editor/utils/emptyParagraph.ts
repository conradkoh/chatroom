import type { ReactNode } from 'react';

const NBSP = '\u00A0';
export function isEmptyParagraphChildren(children: ReactNode): boolean {
  if (children == null || children === false) return true;
  if (typeof children === 'string') {
    const normalized = children.replace(/&amp;nbsp;/gi, NBSP).replace(/\s/g, '');
    return normalized === '' || normalized === NBSP;
  }
  if (Array.isArray(children)) return children.every(isEmptyParagraphChildren);
  return false;
}
