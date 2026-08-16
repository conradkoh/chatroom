'use client';
import { Paperclip, Pencil } from 'lucide-react';
import React, { useState } from 'react';

import { ResponsivePickerShell, PickerOptionRow } from '../picker';

export type AttachmentSourcePickerProps = {
  onPickFile: () => void;
  onPickSketch: () => void;
  disabled?: boolean;
  trigger: React.ReactNode;
};
export function AttachmentSourcePicker({
  onPickFile,
  onPickSketch,
  disabled,
  trigger,
}: AttachmentSourcePickerProps) {
  const [open, setOpen] = useState(false);
  const selectSource = (callback: () => void) => {
    setOpen(false);
    queueMicrotask(callback);
  };
  return (
    <ResponsivePickerShell
      open={open}
      onOpenChange={setOpen}
      disabled={disabled}
      trigger={trigger}
      title="Add attachment"
    >
      <PickerOptionRow
        onSelect={() => selectSource(onPickFile)}
        endAdornment={<Paperclip size={14} aria-hidden />}
      >
        File
      </PickerOptionRow>
      <PickerOptionRow
        onSelect={() => selectSource(onPickSketch)}
        endAdornment={<Pencil size={14} aria-hidden />}
      >
        Sketch
      </PickerOptionRow>
    </ResponsivePickerShell>
  );
}
