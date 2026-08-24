// fallow-ignore-file unused-export
import type { SketchSelectionRect } from './sketchCanvasSelection';

export type SketchLayerId = string;
export type SketchLayerKind = 'paint' | 'pasted-image';
export type SketchLayerMeta = {
  id: SketchLayerId;
  name: string;
  kind: SketchLayerKind;
  hasContent: boolean;
};
export type SketchSelection = { layerId: SketchLayerId; rect: SketchSelectionRect };
export type SketchTransform = {
  x: number;
  y: number;
  scaleX: number;
  scaleY: number;
  rotationRadians: number;
};
export type SketchFloatingSelectionMeta = {
  layerId: SketchLayerId;
  sourceWidth: number;
  sourceHeight: number;
  transform: SketchTransform;
  originRect: SketchSelectionRect | null;
  provenance: 'selection' | 'paste';
  priorActiveLayerId: SketchLayerId | null;
};
export type SketchDocumentState = {
  layers: SketchLayerMeta[];
  activeLayerId: SketchLayerId;
  selection: SketchSelection | null;
  floating: SketchFloatingSelectionMeta | null;
};

export function createLayerId(): SketchLayerId {
  return `layer-${crypto.randomUUID()}`;
}
export function createInitialDocument(): SketchDocumentState {
  const id = createLayerId();
  return {
    layers: [{ id, name: 'Drawing 1', kind: 'paint', hasContent: false }],
    activeLayerId: id,
    selection: null,
    floating: null,
  };
}
// fallow-ignore-next-line complexity
export function assertDocumentInvariants(state: SketchDocumentState): void {
  if (!state.layers.some((layer) => layer.id === state.activeLayerId))
    throw new Error('Active layer must exist');
  if (new Set(state.layers.map((layer) => layer.id)).size !== state.layers.length)
    throw new Error('Layer IDs must be unique');
  if (state.selection && state.selection.layerId !== state.activeLayerId)
    throw new Error('Selection must reference active layer');
  if (state.floating && state.floating.layerId !== state.activeLayerId)
    throw new Error('Floating layer must reference active layer');
  if (state.floating && state.selection)
    throw new Error('Floating and committed selection are mutually exclusive');
}
function checked(state: SketchDocumentState): SketchDocumentState {
  assertDocumentInvariants(state);
  return state;
}
export function addLayer(state: SketchDocumentState, layer: SketchLayerMeta): SketchDocumentState {
  return checked({
    ...state,
    layers: [...state.layers, layer],
    activeLayerId: layer.id,
    selection: null,
    floating: null,
  });
}
export function removeLayer(state: SketchDocumentState, id: SketchLayerId): SketchDocumentState {
  const layers = state.layers.filter((layer) => layer.id !== id);
  if (!layers.length) throw new Error('Cannot remove the last layer');
  return checked({
    ...state,
    layers,
    activeLayerId: layers[layers.length - 1].id,
    selection: null,
    floating: null,
  });
}
export function countPastedImageLayers(state: SketchDocumentState): number {
  return state.layers.filter((layer) => layer.kind === 'pasted-image').length;
}
export function setActiveLayer(state: SketchDocumentState, id: SketchLayerId): SketchDocumentState {
  if (!state.layers.some((layer) => layer.id === id)) throw new Error('Unknown layer');
  return checked({ ...state, activeLayerId: id, selection: null, floating: null });
}
export function setSelection(
  state: SketchDocumentState,
  selection: SketchSelection | null
): SketchDocumentState {
  return checked({ ...state, selection, floating: selection ? null : state.floating });
}
export function setFloating(
  state: SketchDocumentState,
  floating: SketchFloatingSelectionMeta | null
): SketchDocumentState {
  return checked({ ...state, floating, selection: floating ? null : state.selection });
}
export function documentHasContent(state: SketchDocumentState): boolean {
  return state.layers.some((layer) => layer.hasContent);
}
export function updateLayerHasContent(
  state: SketchDocumentState,
  layerId: SketchLayerId,
  hasContent: boolean
): SketchDocumentState {
  return {
    ...state,
    layers: state.layers.map((layer) => (layer.id === layerId ? { ...layer, hasContent } : layer)),
  };
}
