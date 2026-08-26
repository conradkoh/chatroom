import { describe, expect, it, vi } from 'vitest';

import { onStandingEditorKeyDown, wantsStandingConfirm } from './standingInstructionsEditorUtils';

describe('wantsStandingConfirm', () => {
  it('returns true for Ctrl+Enter', () => {
    expect(wantsStandingConfirm({ key: 'Enter', ctrlKey: true, metaKey: false } as any)).toBe(true);
  });

  it('returns true for Meta+Enter', () => {
    expect(wantsStandingConfirm({ key: 'Enter', ctrlKey: false, metaKey: true } as any)).toBe(true);
  });

  it('returns false for plain Enter', () => {
    expect(wantsStandingConfirm({ key: 'Enter', ctrlKey: false, metaKey: false } as any)).toBe(
      false
    );
  });

  it('returns false for non-Enter keys', () => {
    expect(wantsStandingConfirm({ key: 'Escape', ctrlKey: false, metaKey: false } as any)).toBe(
      false
    );
  });
});

describe('onStandingEditorKeyDown', () => {
  it('calls onCancel on Escape', () => {
    const onCancel = vi.fn();
    const onConfirm = vi.fn();
    const e = { key: 'Escape', preventDefault: vi.fn(), ctrlKey: false, metaKey: false } as any;
    onStandingEditorKeyDown(e, onCancel, onConfirm);
    expect(e.preventDefault).toHaveBeenCalled();
    expect(onCancel).toHaveBeenCalled();
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('calls onConfirm on Ctrl+Enter', () => {
    const onCancel = vi.fn();
    const onConfirm = vi.fn();
    const e = { key: 'Enter', preventDefault: vi.fn(), ctrlKey: true, metaKey: false } as any;
    onStandingEditorKeyDown(e, onCancel, onConfirm);
    expect(e.preventDefault).toHaveBeenCalled();
    expect(onConfirm).toHaveBeenCalled();
    expect(onCancel).not.toHaveBeenCalled();
  });

  it('does nothing on plain Enter', () => {
    const onCancel = vi.fn();
    const onConfirm = vi.fn();
    const e = { key: 'Enter', preventDefault: vi.fn(), ctrlKey: false, metaKey: false } as any;
    onStandingEditorKeyDown(e, onCancel, onConfirm);
    expect(e.preventDefault).not.toHaveBeenCalled();
    expect(onCancel).not.toHaveBeenCalled();
    expect(onConfirm).not.toHaveBeenCalled();
  });
});
