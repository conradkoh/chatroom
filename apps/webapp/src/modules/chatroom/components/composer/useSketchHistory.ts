'use client';
import { useCallback, useRef, useState } from 'react';

import type { SketchHistorySnapshot } from './sketchCanvasSnapshot';

const SKETCH_HISTORY_MAX_DEPTH = 25;
export function useSketchHistory() {
  const u = useRef<SketchHistorySnapshot[]>([]);
  const r = useRef<SketchHistorySnapshot[]>([]);
  const [canUndo, setU] = useState(false);
  const [canRedo, setR] = useState(false);
  const sync = () => {
    setU(u.current.length > 0);
    setR(r.current.length > 0);
  };
  const pushSnapshot = useCallback((s: SketchHistorySnapshot) => {
    u.current.push(s);
    if (u.current.length > SKETCH_HISTORY_MAX_DEPTH) u.current.shift();
    r.current = [];
    sync();
  }, []);
  const undo = useCallback((current: SketchHistorySnapshot) => {
    const s = u.current.pop();
    if (s) {
      r.current.push(current);
      sync();
    }
    return s ?? null;
  }, []);
  const redo = useCallback((current: SketchHistorySnapshot) => {
    const s = r.current.pop();
    if (s) {
      u.current.push(current);
      sync();
    }
    return s ?? null;
  }, []);
  const reset = useCallback(() => {
    u.current = [];
    r.current = [];
    sync();
  }, []);
  return { canUndo, canRedo, pushSnapshot, undo, redo, reset };
}
