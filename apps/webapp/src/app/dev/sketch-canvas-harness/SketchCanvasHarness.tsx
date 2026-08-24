'use client';

import { useEffect, useState } from 'react';

import { AttachmentSourcePicker } from '@/modules/chatroom/components/composer/AttachmentSourcePicker';
import { SketchDialog } from '@/modules/chatroom/components/composer/SketchDialog';

export function SketchCanvasHarness() {
  const [sketchOpen, setSketchOpen] = useState(false);
  const [savedFileName, setSavedFileName] = useState<string | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  useEffect(
    () => () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    },
    [previewUrl]
  );
  const handleSave = (file: File) => {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setSavedFileName(file.name);
    setPreviewUrl(URL.createObjectURL(file));
  };
  return (
    <div className="chatroom-root min-h-dvh space-y-6 bg-chatroom-bg-primary p-4 text-chatroom-text-primary">
      <header className="space-y-1">
        <h1 className="text-lg font-semibold">Sketch Canvas Harness</h1>
        <p className="text-sm text-chatroom-text-muted">
          Add Attachment → Sketch → draw → Add sketch. Dev-only; 404 in production.
        </p>
      </header>
      <AttachmentSourcePicker
        onPickFile={() => {}}
        onPickSketch={() => setSketchOpen(true)}
        trigger={
          <button
            type="button"
            data-testid="harness-add-attachment"
            className="rounded-none border-2 border-chatroom-border px-3 py-2 text-sm"
          >
            Add attachment
          </button>
        }
      />
      <SketchDialog open={sketchOpen} onOpenChange={setSketchOpen} onSave={handleSave} />
      {savedFileName ? (
        <div className="space-y-2" data-testid="saved-sketch-panel">
          <p data-testid="saved-sketch-filename">{savedFileName}</p>
          {previewUrl ? (
            <img
              src={previewUrl}
              alt="Saved sketch preview"
              data-testid="saved-sketch-preview"
              className="max-h-48 border-2 border-chatroom-border"
            />
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
