import { describe, expect, it } from 'vitest';

import {
  createInitialDocument,
  addLayer,
  documentHasContent,
  setActiveLayer,
  setFloating,
  setSelection,
} from './sketchDocument';

describe('sketchDocument', () => {
  it('creates a Drawing 1 paint layer', () => {
    const doc = createInitialDocument();
    expect(doc.layers).toHaveLength(1);
    expect(doc.layers[0]).toMatchObject({ name: 'Drawing 1', kind: 'paint', hasContent: false });
  });
  it('transitions active layer and selection/floating state', () => {
    const doc = createInitialDocument();
    const layer = { id: 'two', name: 'Two', kind: 'paint' as const, hasContent: true };
    const next = addLayer(doc, layer);
    expect(setActiveLayer(next, doc.activeLayerId).activeLayerId).toBe(doc.activeLayerId);
    expect(
      setSelection(next, { layerId: layer.id, rect: { x: 0, y: 0, width: 2, height: 2 } }).floating
    ).toBeNull();
    expect(
      setFloating(next, {
        layerId: layer.id,
        sourceWidth: 1,
        sourceHeight: 1,
        transform: { x: 0, y: 0, scaleX: 1, scaleY: 1, rotationRadians: 0 },
        originRect: null,
        provenance: 'paste',
        priorActiveLayerId: null,
      }).selection
    ).toBeNull();
    expect(documentHasContent(next)).toBe(true);
  });
  it('rejects selection for non-active layer', () => {
    const doc = createInitialDocument();
    const withTwo = addLayer(doc, { id: 'other', name: 'Other', kind: 'paint', hasContent: false });
    expect(() =>
      setSelection(withTwo, {
        layerId: doc.activeLayerId,
        rect: { x: 0, y: 0, width: 1, height: 1 },
      })
    ).toThrow(/active layer/i);
  });
});
