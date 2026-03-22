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
 * - Fullscreen modal with pinch/scroll zoom
 */

interface MermaidBlockProps {
  chart: string;
}

// ─── Zoom Constants ──────────────────────────────────────────────────────────

const MIN_ZOOM = 0.25;
const MAX_ZOOM = 4;
const ZOOM_STEP = 0.15;

// ─── Fullscreen Modal ────────────────────────────────────────────────────────

interface MermaidFullscreenModalProps {
  svg: string;
  isOpen: boolean;
  onClose: () => void;
}

const MermaidFullscreenModal = memo(function MermaidFullscreenModal({
  svg,
  isOpen,
  onClose,
}: MermaidFullscreenModalProps) {
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [isPanning, setIsPanning] = useState(false);
  const lastPanRef = useRef({ x: 0, y: 0 });
  const contentRef = useRef<HTMLDivElement>(null);

  // Reset zoom/pan when modal opens
  useEffect(() => {
    if (isOpen) {
      setZoom(1);
      setPan({ x: 0, y: 0 });
    }
  }, [isOpen]);

  // Escape key to close
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  // Scroll wheel zoom
  const handleWheel = useCallback(
    (e: React.WheelEvent) => {
      e.preventDefault();
      const delta = e.deltaY > 0 ? -ZOOM_STEP : ZOOM_STEP;
      setZoom((prev) => Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, prev + delta)));
    },
    []
  );

  // Mouse pan
  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if (e.button !== 0) return; // Only left click
    setIsPanning(true);
    lastPanRef.current = { x: e.clientX, y: e.clientY };
  }, []);

  const handleMouseMove = useCallback(
    (e: React.MouseEvent) => {
      if (!isPanning) return;
      const dx = e.clientX - lastPanRef.current.x;
      const dy = e.clientY - lastPanRef.current.y;
      setPan((prev) => ({ x: prev.x + dx, y: prev.y + dy }));
      lastPanRef.current = { x: e.clientX, y: e.clientY };
    },
    [isPanning]
  );

  const handleMouseUp = useCallback(() => {
    setIsPanning(false);
  }, []);

  // Touch pinch zoom
  const lastTouchDistRef = useRef<number | null>(null);

  const handleTouchMove = useCallback((e: React.TouchEvent) => {
    if (e.touches.length === 2) {
      e.preventDefault();
      const dx = e.touches[0].clientX - e.touches[1].clientX;
      const dy = e.touches[0].clientY - e.touches[1].clientY;
      const dist = Math.sqrt(dx * dx + dy * dy);

      if (lastTouchDistRef.current !== null) {
        const delta = (dist - lastTouchDistRef.current) * 0.005;
        setZoom((prev) => Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, prev + delta)));
      }
      lastTouchDistRef.current = dist;
    } else if (e.touches.length === 1) {
      // Single finger pan
      const touch = e.touches[0];
      const dx = touch.clientX - lastPanRef.current.x;
      const dy = touch.clientY - lastPanRef.current.y;
      setPan((prev) => ({ x: prev.x + dx, y: prev.y + dy }));
      lastPanRef.current = { x: touch.clientX, y: touch.clientY };
    }
  }, []);

  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    if (e.touches.length === 1) {
      lastPanRef.current = { x: e.touches[0].clientX, y: e.touches[0].clientY };
    }
    lastTouchDistRef.current = null;
  }, []);

  const handleTouchEnd = useCallback(() => {
    lastTouchDistRef.current = null;
  }, []);

  const resetView = useCallback(() => {
    setZoom(1);
    setPan({ x: 0, y: 0 });
  }, []);

  const zoomIn = useCallback(() => {
    setZoom((prev) => Math.min(MAX_ZOOM, prev + ZOOM_STEP * 2));
  }, []);

  const zoomOut = useCallback(() => {
    setZoom((prev) => Math.max(MIN_ZOOM, prev - ZOOM_STEP * 2));
  }, []);

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
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
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
            {/* Zoom controls */}
            <button
              onClick={zoomOut}
              className="p-1 text-chatroom-text-muted hover:text-chatroom-text-primary transition-colors"
              title="Zoom out"
            >
              <Minus size={14} />
            </button>
            <span className="text-[10px] font-mono text-chatroom-text-muted min-w-[3rem] text-center">
              {Math.round(zoom * 100)}%
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

        {/* Diagram area — zoomable and pannable */}
        <div
          ref={contentRef}
          className="flex-1 overflow-hidden cursor-grab active:cursor-grabbing"
          onWheel={handleWheel}
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          onMouseLeave={handleMouseUp}
          onTouchStart={handleTouchStart}
          onTouchMove={handleTouchMove}
          onTouchEnd={handleTouchEnd}
        >
          <div
            className="w-full h-full flex items-center justify-center"
            style={{
              transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
              transformOrigin: 'center center',
              transition: isPanning ? 'none' : 'transform 0.1s ease-out',
            }}
          >
            <div
              className="[&_svg]:max-w-none [&_svg]:h-auto"
              dangerouslySetInnerHTML={{ __html: svg }}
            />
          </div>
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
        // Dynamic import to avoid SSR issues
        const mermaid = (await import('mermaid')).default;

        // Detect dark mode from document class (Next.js dark mode adds 'dark' to html)
        const isDark =
          typeof document !== 'undefined' &&
          (document.documentElement.classList.contains('dark') ||
            window.matchMedia('(prefers-color-scheme: dark)').matches);

        mermaid.initialize({
          startOnLoad: false,
          theme: isDark ? 'dark' : 'default',
          securityLevel: 'strict',
          // Use square/rectangular nodes for better text wrapping
          flowchart: {
            htmlLabels: true,
            curve: 'basis',
            nodeSpacing: 30,
            rankSpacing: 50,
            useMaxWidth: true,
            wrappingWidth: 200,
          },
          // Ensure diagrams respect container width
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

    return () => {
      cancelled = true;
    };
  }, [chart]);

  // Loading state
  if (loading && !error) {
    return (
      <div className="my-3 flex justify-center p-4 bg-chatroom-bg-tertiary border-2 border-chatroom-border">
        <span className="text-xs text-chatroom-text-muted">Rendering diagram...</span>
      </div>
    );
  }

  // Error fallback: show raw code
  if (error) {
    return (
      <pre className="bg-chatroom-bg-tertiary border-2 border-chatroom-border p-3 my-3 overflow-x-auto text-sm text-chatroom-text-primary">
        <code>{chart}</code>
      </pre>
    );
  }

  // Rendered SVG with expand button
  return (
    <>
      <div className="relative my-3 group">
        <div
          ref={containerRef}
          className="flex justify-center overflow-x-auto [&_svg]:max-w-full [&_svg]:h-auto [&_svg]:min-w-0"
          style={{ maxWidth: '100%' }}
          /* SECURITY: SVG is rendered by mermaid with securityLevel: 'strict', which
             sanitizes the output. The chart content originates from agent messages
             (not untrusted external input). See: https://mermaid.js.org/config/security.html */
          dangerouslySetInnerHTML={{ __html: svg }}
        />
        {/* Expand button — appears on hover */}
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
