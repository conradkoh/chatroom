'use client';

import { Maximize2, Minus, Plus, RotateCcw } from 'lucide-react';
import React, { useEffect, useRef, useState, useCallback, memo } from 'react';
import { createPortal } from 'react-dom';

/**
 * MermaidBlock renders a mermaid diagram from a chart definition string.
 * Uses dynamic import to avoid SSR issues with mermaid.
 *
 * Features:
 * - Dark/light mode detection via document class
 * - Graceful fallback to raw code on parse errors
 * - Unique IDs for concurrent rendering
 * - Fullscreen modal with SVG viewBox-based zoom (crisp text at all zoom levels)
 */

interface MermaidBlockProps {
  chart: string;
}

// ─── Zoom Constants ──────────────────────────────────────────────────────────

const MIN_ZOOM = 0.25;
const MAX_ZOOM = 4;
const ZOOM_STEP = 0.05;

// ─── ViewBox type ────────────────────────────────────────────────────────────

interface ViewBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

// ─── Fullscreen Modal ────────────────────────────────────────────────────────

interface MermaidFullscreenModalProps {
  svg: string;
  isOpen: boolean;
  onClose: () => void;
}

/**
 * Fullscreen mermaid diagram viewer with SVG viewBox-based zoom and pan.
 *
 * Performance: Uses SVG viewBox manipulation instead of CSS transforms.
 * Text renders crisp at any zoom level since the browser re-rasterizes
 * the SVG natively. Transform state is stored in refs and applied via
 * requestAnimationFrame to bypass React's render cycle.
 */
const MermaidFullscreenModal = memo(function MermaidFullscreenModal({
  svg,
  isOpen,
  onClose,
}: MermaidFullscreenModalProps) {
  // Zoom/pan state in refs — no React re-renders on interaction
  const zoomRef = useRef(1);
  const panRef = useRef({ x: 0, y: 0 }); // Pan in SVG coordinate space
  const baseViewBoxRef = useRef<ViewBox | null>(null);
  const lastPanRef = useRef({ x: 0, y: 0 });
  const lastTouchDistRef = useRef<number | null>(null);
  const rafRef = useRef<number | null>(null);

  // DOM refs
  const containerRef = useRef<HTMLDivElement>(null);
  const svgContainerRef = useRef<HTMLDivElement>(null);
  const zoomLabelRef = useRef<HTMLSpanElement>(null);

  // Update zoom label via direct DOM mutation — zero React re-renders
  const updateZoomLabel = useCallback(() => {
    if (zoomLabelRef.current) {
      zoomLabelRef.current.textContent = `${Math.round(zoomRef.current * 100)}%`;
    }
  }, []);

  // Apply viewBox to the SVG element — crisp rendering at any zoom
  const applyViewBox = useCallback(() => {
    const svgEl = svgContainerRef.current?.querySelector('svg');
    const base = baseViewBoxRef.current;
    if (!svgEl || !base) return;

    const vbWidth = base.width / zoomRef.current;
    const vbHeight = base.height / zoomRef.current;
    // Center the zoom, then apply pan offset (pan is in SVG units)
    const vbX = base.x + (base.width - vbWidth) / 2 - panRef.current.x;
    const vbY = base.y + (base.height - vbHeight) / 2 - panRef.current.y;

    svgEl.setAttribute('viewBox', `${vbX} ${vbY} ${vbWidth} ${vbHeight}`);
  }, []);

  // Schedule viewBox update via rAF
  const scheduleUpdate = useCallback(() => {
    if (rafRef.current !== null) return;
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = null;
      applyViewBox();
    });
  }, [applyViewBox]);

  // Initialize SVG for viewBox-based zoom when modal opens
  useEffect(() => {
    if (!isOpen) return;

    // Use rAF to wait for the browser to paint the SVG from dangerouslySetInnerHTML.
    // More robust than setTimeout — fires after layout/paint cycle completes.
    const rafId = requestAnimationFrame(() => {
      const svgEl = svgContainerRef.current?.querySelector('svg');
      if (!svgEl) return;

      // Read the original viewBox (mermaid usually sets one)
      const vb = svgEl.viewBox?.baseVal;
      if (vb && vb.width > 0 && vb.height > 0) {
        baseViewBoxRef.current = { x: vb.x, y: vb.y, width: vb.width, height: vb.height };
      } else {
        // Fallback: use getBBox for the natural bounds
        const bbox = svgEl.getBBox();
        baseViewBoxRef.current = { x: bbox.x, y: bbox.y, width: bbox.width, height: bbox.height };
        svgEl.setAttribute(
          'viewBox',
          `${bbox.x} ${bbox.y} ${bbox.width} ${bbox.height}`
        );
      }

      // Make SVG fill the container — remove mermaid's inline max-width constraint
      svgEl.style.maxWidth = 'none';
      svgEl.setAttribute('width', '100%');
      svgEl.setAttribute('height', '100%');
      svgEl.setAttribute('preserveAspectRatio', 'xMidYMid meet');

      // Reset zoom/pan
      zoomRef.current = 1;
      panRef.current = { x: 0, y: 0 };
      updateZoomLabel();
    });

    return () => {
      cancelAnimationFrame(rafId);
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
    };
  }, [isOpen]);

  // Native event listeners for smooth interaction
  useEffect(() => {
    if (!isOpen) return;
    const container = containerRef.current;
    if (!container) return;

    // Convert pixel delta to SVG coordinate delta
    const pixelToSvg = (pixelDelta: number): number => {
      const base = baseViewBoxRef.current;
      if (!base) return 0;
      const containerWidth = container.clientWidth;
      const currentVbWidth = base.width / zoomRef.current;
      return pixelDelta * (currentVbWidth / containerWidth);
    };

    // Wheel zoom
    const handleWheel = (e: WheelEvent) => {
      e.preventDefault();
      const delta = e.deltaY > 0 ? -ZOOM_STEP : ZOOM_STEP;
      zoomRef.current = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, zoomRef.current + delta));
      scheduleUpdate();
      updateZoomLabel();
    };

    // Mouse pan
    let isPanning = false;
    const handleMouseDown = (e: MouseEvent) => {
      if (e.button !== 0) return;
      isPanning = true;
      lastPanRef.current = { x: e.clientX, y: e.clientY };
      container.style.cursor = 'grabbing';
    };

    const handleMouseMove = (e: MouseEvent) => {
      if (!isPanning) return;
      const dx = e.clientX - lastPanRef.current.x;
      const dy = e.clientY - lastPanRef.current.y;
      // Convert pixel movement to SVG units and apply (negative because viewBox moves opposite)
      panRef.current = {
        x: panRef.current.x + pixelToSvg(dx),
        y: panRef.current.y + pixelToSvg(dy),
      };
      lastPanRef.current = { x: e.clientX, y: e.clientY };
      scheduleUpdate();
    };

    const handleMouseUp = () => {
      isPanning = false;
      container.style.cursor = 'grab';
    };

    // Touch events
    const handleTouchStart = (e: TouchEvent) => {
      if (e.touches.length === 1) {
        lastPanRef.current = { x: e.touches[0].clientX, y: e.touches[0].clientY };
      }
      lastTouchDistRef.current = null;
    };

    const handleTouchMove = (e: TouchEvent) => {
      if (e.touches.length === 2) {
        e.preventDefault();
        const dx = e.touches[0].clientX - e.touches[1].clientX;
        const dy = e.touches[0].clientY - e.touches[1].clientY;
        const dist = Math.sqrt(dx * dx + dy * dy);

        if (lastTouchDistRef.current !== null) {
          const delta = (dist - lastTouchDistRef.current) * 0.005;
          zoomRef.current = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, zoomRef.current + delta));
          updateZoomLabel();
        }
        lastTouchDistRef.current = dist;
        scheduleUpdate();
      } else if (e.touches.length === 1) {
        const touch = e.touches[0];
        const dx = touch.clientX - lastPanRef.current.x;
        const dy = touch.clientY - lastPanRef.current.y;
        panRef.current = {
          x: panRef.current.x + pixelToSvg(dx),
          y: panRef.current.y + pixelToSvg(dy),
        };
        lastPanRef.current = { x: touch.clientX, y: touch.clientY };
        scheduleUpdate();
      }
    };

    const handleTouchEnd = () => {
      lastTouchDistRef.current = null;
    };

    container.addEventListener('wheel', handleWheel, { passive: false });
    container.addEventListener('mousedown', handleMouseDown);
    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    container.addEventListener('touchstart', handleTouchStart, { passive: true });
    container.addEventListener('touchmove', handleTouchMove, { passive: false });
    container.addEventListener('touchend', handleTouchEnd);

    return () => {
      container.removeEventListener('wheel', handleWheel);
      container.removeEventListener('mousedown', handleMouseDown);
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
      container.removeEventListener('touchstart', handleTouchStart);
      container.removeEventListener('touchmove', handleTouchMove);
      container.removeEventListener('touchend', handleTouchEnd);
    };
  }, [isOpen, scheduleUpdate, updateZoomLabel]);

  // Escape key
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  const resetView = useCallback(() => {
    zoomRef.current = 1;
    panRef.current = { x: 0, y: 0 };
    applyViewBox();
    updateZoomLabel();
  }, [applyViewBox]);

  const zoomIn = useCallback(() => {
    zoomRef.current = Math.min(MAX_ZOOM, zoomRef.current + ZOOM_STEP * 2);
    applyViewBox();
    updateZoomLabel();
  }, [applyViewBox, updateZoomLabel]);

  const zoomOut = useCallback(() => {
    zoomRef.current = Math.max(MIN_ZOOM, zoomRef.current - ZOOM_STEP * 2);
    applyViewBox();
    updateZoomLabel();
  }, [applyViewBox, updateZoomLabel]);

  const handleBackdropClick = useCallback(
    (e: React.MouseEvent) => {
      if (e.target === e.currentTarget) onClose();
    },
    [onClose]
  );

  if (!isOpen) return null;
  if (typeof document === 'undefined') return null;

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
      onClick={handleBackdropClick}
    >
      {/* Modal panel — landscape-oriented, near-full viewport */}
      <div className="chatroom-root relative w-[95vw] h-[85vh] bg-chatroom-bg-primary border-2 border-chatroom-border-strong flex flex-col overflow-hidden">
        {/* Header bar */}
        <div className="flex items-center justify-between px-4 py-2 border-b-2 border-chatroom-border-strong bg-chatroom-bg-surface flex-shrink-0">
          <span className="text-xs font-bold uppercase tracking-widest text-chatroom-text-muted">
            Mermaid Diagram
          </span>
          <div className="flex items-center gap-2">
            <button
              onClick={zoomOut}
              className="p-1 text-chatroom-text-muted hover:text-chatroom-text-primary transition-colors"
              title="Zoom out"
            >
              <Minus size={14} />
            </button>
            <span ref={zoomLabelRef} className="text-[10px] font-mono text-chatroom-text-muted min-w-[3rem] text-center">
              100%
            </span>
            <button
              onClick={zoomIn}
              className="p-1 text-chatroom-text-muted hover:text-chatroom-text-primary transition-colors"
              title="Zoom in"
            >
              <Plus size={14} />
            </button>
            <button
              onClick={resetView}
              className="p-1 text-chatroom-text-muted hover:text-chatroom-text-primary transition-colors"
              title="Reset view"
            >
              <RotateCcw size={14} />
            </button>
            <div className="w-px h-4 bg-chatroom-border mx-1" />
            <button
              onClick={onClose}
              className="px-2 py-1 text-[10px] font-bold uppercase tracking-wide text-chatroom-text-muted hover:text-chatroom-text-primary transition-colors"
            >
              Close
            </button>
          </div>
        </div>

        {/* Diagram area — SVG viewBox zoom */}
        <div
          ref={containerRef}
          className="flex-1 overflow-hidden cursor-grab select-none"
          style={{ touchAction: 'none' }}
        >
          <div
            ref={svgContainerRef}
            className="w-full h-full [&_svg]:w-full [&_svg]:h-full"
            dangerouslySetInnerHTML={{ __html: svg }}
          />
        </div>
      </div>
    </div>,
    document.body
  );
});

// ─── Main Component ──────────────────────────────────────────────────────────

export const MermaidBlock = memo(function MermaidBlock({ chart }: MermaidBlockProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [svg, setSvg] = useState<string>('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [isModalOpen, setIsModalOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function renderChart() {
      try {
        const mermaid = (await import('mermaid')).default;
        const isDark =
          typeof document !== 'undefined' &&
          (document.documentElement.classList.contains('dark') ||
            window.matchMedia('(prefers-color-scheme: dark)').matches);

        mermaid.initialize({
          startOnLoad: false,
          theme: isDark ? 'dark' : 'default',
          securityLevel: 'strict',
          flowchart: {
            // Use SVG text instead of HTML foreignObject labels.
            // foreignObject sizing is unreliable across browsers and causes
            // text to be clipped when node content exceeds the fixed box size.
            // SVG text nodes auto-size to their content, eliminating truncation.
            htmlLabels: false,
            curve: 'basis',
            nodeSpacing: 30,
            rankSpacing: 50,
            useMaxWidth: true,
            // Remove the 200px wrapping cap — let the layout engine size nodes
            // naturally based on their content length.
            wrappingWidth: 500,
          },
          themeVariables: {
            fontSize: '12px',
          },
        });

        const id = `mermaid-${Math.random().toString(36).slice(2, 10)}`;
        const { svg: renderedSvg } = await mermaid.render(id, chart);

        if (!cancelled) {
          setSvg(renderedSvg);
          setLoading(false);
        }
      } catch (err) {
        if (!cancelled) {
          const message = err instanceof Error ? err.message : 'Failed to render diagram';
          setError(message);
          setLoading(false);
        }
      }
    }

    renderChart();
    return () => { cancelled = true; };
  }, [chart]);

  if (loading && !error) {
    return (
      <div className="my-3 flex justify-center p-4 bg-chatroom-bg-tertiary border-2 border-chatroom-border">
        <span className="text-xs text-chatroom-text-muted">Rendering diagram...</span>
      </div>
    );
  }

  if (error) {
    return (
      <pre className="bg-chatroom-bg-tertiary border-2 border-chatroom-border p-3 my-3 overflow-x-auto text-sm text-chatroom-text-primary">
        <code>{chart}</code>
      </pre>
    );
  }

  return (
    <>
      <div className="relative my-3 group">
        <div
          ref={containerRef}
          className="flex justify-center overflow-x-auto [&_svg]:max-w-full [&_svg]:h-auto [&_svg]:min-w-0"
          style={{ maxWidth: '100%' }}
          dangerouslySetInnerHTML={{ __html: svg }}
        />
        <button
          onClick={() => setIsModalOpen(true)}
          className="absolute top-2 right-2 p-1.5 bg-chatroom-bg-primary/80 border border-chatroom-border text-chatroom-text-muted hover:text-chatroom-text-primary hover:bg-chatroom-bg-hover transition-all opacity-0 group-hover:opacity-100"
          title="View fullscreen"
        >
          <Maximize2 size={14} />
        </button>
      </div>
      <MermaidFullscreenModal
        svg={svg}
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
      />
    </>
  );
});
