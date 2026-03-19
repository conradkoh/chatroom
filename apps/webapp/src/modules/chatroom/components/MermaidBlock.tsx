'use client';

import React, { useEffect, useRef, useState, memo } from 'react';

/**
 * MermaidBlock renders a mermaid diagram from a chart definition string.
 * Uses dynamic import to avoid SSR issues with mermaid.
 *
 * Features:
 * - Dark/light mode detection via document class
 * - Graceful fallback to raw code on parse errors
 * - Unique IDs for concurrent rendering
 */

interface MermaidBlockProps {
  chart: string;
}

export const MermaidBlock = memo(function MermaidBlock({ chart }: MermaidBlockProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [svg, setSvg] = useState<string>('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

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

  // Rendered SVG
  return (
    <div
      ref={containerRef}
      className="my-3 flex justify-center overflow-x-auto [&_svg]:max-w-full"
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  );
});
