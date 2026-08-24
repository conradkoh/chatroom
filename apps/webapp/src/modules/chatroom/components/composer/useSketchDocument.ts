'use client';
// fallow-ignore-file complexity
import {
  useCallback,
  useLayoutEffect,
  useRef,
  useState,
  type ComponentProps,
  type PointerEvent as ReactPointerEvent,
  type RefObject,
} from 'react';

import { renderSketchComposite, layerHasNonTransparentPixels } from './sketchCanvasComposite';
import {
  createTransparentLayerBitmap,
  clearSketchRegion,
  drawSketchEraseDot,
  drawSketchEraseSegment,
  drawSketchDot,
  drawSketchSegment,
  getCssToCanvasScale,
  mapClientPointToCanvas,
} from './sketchCanvasDrawing';
import {
  getCoalescedPointerEvents,
  processCoalescedPointerMove,
  shouldStartSketchStroke,
  endSketchStroke,
  type ActiveSketchStroke,
} from './sketchCanvasPointer';
import type { SketchSelectionRect } from './sketchCanvasSelection';
import { type SketchBrushColor } from './sketchConstants';
import {
  createInitialDocument,
  createLayerId,
  documentHasContent,
  setSelection,
  updateLayerHasContent,
  type SketchLayerId,
  type SketchSelection,
  type SketchFloatingSelectionMeta,
  type SketchTransform,
  addLayer,
  countPastedImageLayers,
  removeLayer,
  setActiveLayer,
} from './sketchDocument';
import { buildSketchFileName } from './sketchFileName';
import { applySketchTransform, computeContainTransform } from './sketchTransform';

export type UseSketchDocumentArgs = {
  brushColor: SketchBrushColor;
  brushSize: number;
  disabled: boolean;
  eraserMode?: boolean;
};
export type UseSketchDocumentResult = {
  canvasRef: RefObject<HTMLCanvasElement | null>;
  layers: ReturnType<typeof createInitialDocument>['layers'];
  activeLayerId: SketchLayerId;
  selection: SketchSelection | null;
  clearSelection: () => void;
  onSelectionChange: (selection: SketchSelection | null) => void;
  hasContent: boolean;
  canvasBindings: Pick<
    ComponentProps<'canvas'>,
    'onPointerDown' | 'onPointerMove' | 'onPointerUp' | 'onPointerCancel' | 'onLostPointerCapture'
  >;
  exportPngFile: () => Promise<File | null>;
  deleteRegion: (selection: SketchSelectionRect) => void;
  floating: SketchFloatingSelectionMeta | null;
  beginFloatingSelection: () => SketchFloatingSelectionMeta | null;
  updateFloatingTransform: (transform: SketchTransform) => void;
  applyFloatingSelection: () => void;
  cancelFloatingSelection: () => void;
  discardFloatingSelection: () => void;
  importPastedImage: (file: File) => Promise<boolean>;
  setActiveLayerId: (id: SketchLayerId) => void;
};
export function useSketchDocument({
  brushColor,
  brushSize,
  disabled,
  eraserMode = false,
}: UseSketchDocumentArgs): UseSketchDocumentResult {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const layersRef = useRef(new Map<SketchLayerId, HTMLCanvasElement>());
  const activeRef = useRef<ActiveSketchStroke | null>(null);
  const rafRef = useRef<number | null>(null);
  const [doc, setDoc] = useState(createInitialDocument);
  const floatingBitmapRef = useRef<HTMLCanvasElement | null>(null);
  const floatingBackupRef = useRef<ImageData | null>(null);
  const floatingTransformRef = useRef<SketchTransform | null>(null);
  const onSelectionChange = useCallback((selection: SketchSelection | null) => {
    setDoc((state) => setSelection(state, selection));
  }, []);
  const clearSelection = useCallback(() => onSelectionChange(null), [onSelectionChange]);
  const paintComposite = useCallback(
    (
      ctx: CanvasRenderingContext2D,
      floatingPreview:
        { bitmap: HTMLCanvasElement; transform: SketchTransform } | null | undefined = undefined
    ) => {
      const preview =
        floatingPreview === undefined
          ? doc.floating && floatingBitmapRef.current
            ? {
                bitmap: floatingBitmapRef.current,
                transform: floatingTransformRef.current ?? doc.floating.transform,
              }
            : null
          : floatingPreview;
      renderSketchComposite(
        ctx,
        doc.layers
          .map((layer) => layersRef.current.get(layer.id))
          .filter((layer): layer is HTMLCanvasElement => Boolean(layer)),
        preview
      );
    },
    [doc.floating, doc.layers]
  );
  const scheduleComposite = useCallback(() => {
    if (rafRef.current != null) return;
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = null;
      const canvas = canvasRef.current;
      const ctx = canvas?.getContext('2d');
      if (canvas && ctx && typeof ctx.save === 'function') paintComposite(ctx);
    });
  }, [paintComposite]);
  const setActiveLayerId = useCallback(
    (id: SketchLayerId) => {
      if (doc.floating) return;
      floatingBitmapRef.current = null;
      floatingTransformRef.current = null;
      floatingBackupRef.current = null;
      setDoc((state) => setActiveLayer(state, id));
      scheduleComposite();
    },
    [doc.floating, scheduleComposite]
  );
  useLayoutEffect(() => {
    for (const layer of doc.layers) {
      if (!layersRef.current.has(layer.id))
        layersRef.current.set(layer.id, createTransparentLayerBitmap());
    }
    const layer = doc.layers[0];
    if (!layer) return;
    const canvas = canvasRef.current;
    const context = canvas?.getContext('2d');
    if (canvas && context && typeof context.save === 'function') {
      const bitmaps = doc.layers
        .map((item) => layersRef.current.get(item.id))
        .filter((b): b is HTMLCanvasElement => Boolean(b));
      renderSketchComposite(
        context,
        bitmaps,
        doc.floating && floatingBitmapRef.current
          ? {
              bitmap: floatingBitmapRef.current,
              transform: floatingTransformRef.current ?? doc.floating.transform,
            }
          : null
      );
    }
    return () => {
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
    };
  }, [doc.layers, scheduleComposite]);
  const activeContext = useCallback(
    () => layersRef.current.get(doc.activeLayerId)?.getContext('2d') ?? null,
    [doc.activeLayerId]
  );
  const mark = useCallback(
    (value: boolean) => setDoc((state) => updateLayerHasContent(state, doc.activeLayerId, value)),
    [doc.activeLayerId]
  );
  const drawAt = useCallback(
    (point: { x: number; y: number }, canvas: HTMLCanvasElement) => {
      const ctx = activeContext();
      if (!ctx) return;
      const scale = getCssToCanvasScale(canvas);
      if (eraserMode) drawSketchEraseDot(ctx, point, brushSize, scale);
      else drawSketchDot(ctx, point, { color: brushColor, size: brushSize }, scale);
      if (!eraserMode) mark(true);
      scheduleComposite();
    },
    [activeContext, brushColor, brushSize, eraserMode, mark, scheduleComposite]
  );
  const drawSegment = useCallback(
    (
      from: { x: number; y: number },
      to: { x: number; y: number },
      _brush: unknown,
      canvas: HTMLCanvasElement
    ) => {
      const ctx = activeContext();
      if (!ctx) return;
      const scale = getCssToCanvasScale(canvas);
      if (eraserMode) drawSketchEraseSegment(ctx, from, to, brushSize, scale);
      else drawSketchSegment(ctx, from, to, { color: brushColor, size: brushSize }, scale);
      if (!eraserMode) mark(true);
      scheduleComposite();
    },
    [activeContext, brushColor, brushSize, eraserMode, mark, scheduleComposite]
  );
  const onPointerDown: ComponentProps<'canvas'>['onPointerDown'] = useCallback(
    (e: ReactPointerEvent<HTMLCanvasElement>) => {
      if (!shouldStartSketchStroke(disabled, e.isPrimary, e.button, activeRef.current != null))
        return;
      const canvas = canvasRef.current;
      const point = canvas && mapClientPointToCanvas(e.clientX, e.clientY, canvas);
      if (!canvas || !point) return;
      drawAt(point, canvas);
      activeRef.current = {
        pointerId: e.pointerId,
        lastPoint: point,
        brush: { color: brushColor, size: brushSize },
      };
      canvas.setPointerCapture(e.pointerId);
    },
    [brushColor, brushSize, disabled, drawAt]
  );
  const onPointerMove: ComponentProps<'canvas'>['onPointerMove'] = useCallback(
    (e: ReactPointerEvent<HTMLCanvasElement>) => {
      const canvas = canvasRef.current;
      const active = activeRef.current;
      if (!canvas || !active || active.pointerId !== e.pointerId) return;
      processCoalescedPointerMove(
        canvas,
        getCoalescedPointerEvents(e.nativeEvent),
        active,
        drawSegment
      );
    },
    [drawSegment]
  );
  const finish = useCallback(
    (e: ReactPointerEvent<HTMLCanvasElement>) => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      endSketchStroke(canvas, e.pointerId, activeRef.current);
      if (activeRef.current?.pointerId === e.pointerId) {
        activeRef.current = null;
        if (eraserMode) {
          const ctx = activeContext();
          mark(Boolean(ctx && layerHasNonTransparentPixels(ctx)));
          scheduleComposite();
        }
      }
    },
    [activeContext, eraserMode, mark, scheduleComposite]
  );
  const deleteRegion = useCallback(
    (selection: SketchSelectionRect) => {
      const ctx = activeContext();
      if (!ctx) return;
      clearSketchRegion(ctx, selection);
      mark(layerHasNonTransparentPixels(ctx));
      scheduleComposite();
      const canvas = canvasRef.current;
      const compositeContext = canvas?.getContext('2d');
      if (canvas && compositeContext && typeof compositeContext.save === 'function')
        paintComposite(compositeContext, null);
    },
    [activeContext, mark, paintComposite]
  );
  const beginFloatingSelection = useCallback((): SketchFloatingSelectionMeta | null => {
    const selection = doc.selection;
    const layer =
      selection && selection.layerId === doc.activeLayerId
        ? layersRef.current.get(doc.activeLayerId)
        : null;
    const ctx = layer?.getContext('2d');
    if (!selection || !layer || !ctx || doc.floating) return null;
    const r = selection.rect;
    const backup = ctx.getImageData(r.x, r.y, r.width, r.height);
    const bitmap = document.createElement('canvas');
    bitmap.width = r.width;
    bitmap.height = r.height;
    bitmap.getContext('2d')?.putImageData(backup, 0, 0);
    ctx.clearRect(r.x, r.y, r.width, r.height);
    floatingBitmapRef.current = bitmap;
    floatingBackupRef.current = backup;
    const meta: SketchFloatingSelectionMeta = {
      layerId: doc.activeLayerId,
      sourceWidth: r.width,
      sourceHeight: r.height,
      transform: { x: r.x, y: r.y, scaleX: 1, scaleY: 1, rotationRadians: 0 },
      originRect: r,
      provenance: 'selection',
      priorActiveLayerId: null,
    };
    floatingTransformRef.current = meta.transform;
    setDoc((state) => ({
      ...state,
      selection: null,
      floating: meta,
    }));
    scheduleComposite();
    return meta;
  }, [doc, scheduleComposite]);
  const updateFloatingTransform = useCallback(
    (transform: SketchTransform) => {
      setDoc((state) =>
        state.floating ? { ...state, floating: { ...state.floating, transform } } : state
      );
      floatingTransformRef.current = transform;
      scheduleComposite();
    },
    [scheduleComposite]
  );
  const finishPasteFloating = useCallback(
    (floating: SketchFloatingSelectionMeta) => {
      layersRef.current.delete(floating.layerId);
      floatingBitmapRef.current = null;
      floatingTransformRef.current = null;
      setDoc((state) => {
        let next = removeLayer(state, floating.layerId);
        if (
          floating.priorActiveLayerId &&
          next.layers.some((layer) => layer.id === floating.priorActiveLayerId)
        )
          next = setActiveLayer(next, floating.priorActiveLayerId);
        return next;
      });
      scheduleComposite();
    },
    [scheduleComposite]
  );
  const cancelFloatingSelection = useCallback(() => {
    if (!doc.floating) return;
    if (doc.floating.provenance === 'paste') {
      finishPasteFloating(doc.floating);
      return;
    }
    const layer = layersRef.current.get(doc.activeLayerId);
    const ctx = layer?.getContext('2d');
    if (ctx && doc.floating.originRect && floatingBackupRef.current)
      ctx.putImageData(
        floatingBackupRef.current,
        doc.floating.originRect.x,
        doc.floating.originRect.y
      );
    floatingBitmapRef.current = null;
    floatingBackupRef.current = null;
    floatingTransformRef.current = null;
    if (ctx) mark(layerHasNonTransparentPixels(ctx));
    setDoc((state) => ({ ...state, floating: null }));
    scheduleComposite();
  }, [doc, finishPasteFloating, mark, scheduleComposite]);
  const discardFloatingSelection = useCallback(() => {
    if (!doc.floating) return;
    if (doc.floating.provenance === 'paste') {
      finishPasteFloating(doc.floating);
      return;
    }
    floatingBitmapRef.current = null;
    floatingBackupRef.current = null;
    floatingTransformRef.current = null;
    const layer = layersRef.current.get(doc.activeLayerId);
    const ctx = layer?.getContext('2d');
    if (ctx) mark(layerHasNonTransparentPixels(ctx));
    setDoc((state) => ({ ...state, floating: null }));
    scheduleComposite();
  }, [doc, finishPasteFloating, mark, scheduleComposite]);
  const importPastedImage = useCallback(
    async (file: File) => {
      let objectUrl: string | null = null;
      try {
        let decoded: ImageBitmap | HTMLImageElement;
        try {
          decoded = await createImageBitmap(file);
        } catch {
          objectUrl = URL.createObjectURL(file);
          const image = new Image();
          image.src = objectUrl;
          await image.decode();
          decoded = image;
        }
        const bitmap = document.createElement('canvas');
        bitmap.width = decoded.width;
        bitmap.height = decoded.height;
        if (!decoded.width || !decoded.height) return false;
        bitmap.getContext('2d')?.drawImage(decoded, 0, 0);
        if ('close' in decoded) decoded.close();
        const id = createLayerId();
        const transform = computeContainTransform(bitmap.width, bitmap.height);
        floatingBitmapRef.current = bitmap;
        floatingTransformRef.current = transform;
        setDoc((state) => {
          const next = addLayer(state, {
            id,
            name: `Pasted image ${countPastedImageLayers(state) + 1}`,
            kind: 'pasted-image',
            hasContent: false,
          });
          return {
            ...next,
            floating: {
              layerId: id,
              sourceWidth: bitmap.width,
              sourceHeight: bitmap.height,
              transform,
              originRect: null,
              provenance: 'paste',
              priorActiveLayerId: state.activeLayerId,
            },
          };
        });
        scheduleComposite();
        return true;
      } catch {
        return false;
      } finally {
        if (objectUrl) URL.revokeObjectURL(objectUrl);
      }
    },
    [scheduleComposite]
  );
  const applyFloatingSelection = useCallback(() => {
    if (!doc.floating || !floatingBitmapRef.current) return;
    const ctx = layersRef.current.get(doc.activeLayerId)?.getContext('2d');
    const bitmap = floatingBitmapRef.current;
    if (ctx && bitmap)
      applySketchTransform(ctx, doc.floating.transform, () => ctx.drawImage(bitmap, 0, 0));
    floatingBitmapRef.current = null;
    floatingBackupRef.current = null;
    floatingTransformRef.current = null;
    setDoc((state) => ({
      ...state,
      floating: null,
      layers: state.layers.map((l) =>
        l.id === state.activeLayerId ? { ...l, hasContent: true } : l
      ),
    }));
    scheduleComposite();
  }, [doc, scheduleComposite]);
  const exportPngFile = useCallback(
    () =>
      new Promise<File | null>((resolve) => {
        const canvas = canvasRef.current;
        const ctx = canvas?.getContext('2d');
        if (!canvas || !ctx || !(documentHasContent(doc) || doc.floating)) return resolve(null);
        if (typeof ctx.save === 'function') paintComposite(ctx);
        canvas.toBlob(
          (blob) =>
            resolve(blob ? new File([blob], buildSketchFileName(), { type: 'image/png' }) : null),
          'image/png'
        );
      }),
    [doc, paintComposite]
  );
  return {
    canvasRef,
    layers: doc.layers,
    activeLayerId: doc.activeLayerId,
    selection: doc.selection,
    clearSelection,
    onSelectionChange,
    hasContent: documentHasContent(doc) || doc.floating != null,
    canvasBindings: {
      onPointerDown,
      onPointerMove,
      onPointerUp: finish,
      onPointerCancel: finish,
      onLostPointerCapture: finish,
    },
    exportPngFile,
    deleteRegion,
    floating: doc.floating,
    beginFloatingSelection,
    updateFloatingTransform,
    applyFloatingSelection,
    cancelFloatingSelection,
    discardFloatingSelection,
    importPastedImage,
    setActiveLayerId,
  };
}
