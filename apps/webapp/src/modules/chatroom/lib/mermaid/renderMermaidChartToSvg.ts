let mermaidInitialized = false;

// fallow-ignore-next-line complexity
export async function renderMermaidChartToSvg(chart: string): Promise<string> {
  const mermaid = (await import('mermaid')).default;
  if (!mermaidInitialized) {
    const isDark =
      typeof document !== 'undefined' &&
      (document.documentElement.classList.contains('dark') ||
        window.matchMedia('(prefers-color-scheme: dark)').matches);

    mermaid.initialize({
      startOnLoad: false,
      theme: isDark ? 'dark' : 'default',
      securityLevel: 'strict',
      htmlLabels: false,
      flowchart: {
        curve: 'basis',
        nodeSpacing: 30,
        rankSpacing: 50,
        useMaxWidth: false,
        padding: 20,
        wrappingWidth: 500,
        diagramPadding: 16,
      },
      themeVariables: {
        fontSize: '12px',
      },
    });
    mermaidInitialized = true;
  }

  const id = `mermaid-export-${Math.random().toString(36).slice(2, 10)}`;
  const { svg } = await mermaid.render(id, chart.trim());

  // Post-process the rendered SVG for cross-browser compatibility.
  let cleanedSvg = svg;

  // Remove max-width inline style
  cleanedSvg = cleanedSvg.replace(
    /(<svg[^>]*)\bstyle="([^"]*)max-width:[^;";]*;?([^"]*)"/,
    (_m, open, before, after) => {
      const cleanStyle = (before + after).replace(/;\s*;/g, ';').replace(/^\s*;\s*|\s*;\s*$/g, '');
      return cleanStyle ? `${open} style="${cleanStyle}"` : open;
    }
  );

  // Force overflow="visible" on root SVG
  if (/(<svg[^>]*)\boverflow="[^"]*"/.test(cleanedSvg)) {
    cleanedSvg = cleanedSvg.replace(/(<svg[^>]*)\boverflow="[^"]*"/, '$1overflow="visible"');
  } else {
    cleanedSvg = cleanedSvg.replace(/(<svg\b)/, '$1 overflow="visible"');
  }

  // Pad the viewBox by 8px on each side
  const VB_PAD = 8;
  cleanedSvg = cleanedSvg.replace(/(<svg[^>]*\bviewBox=")([^"]*)(")/, (_m, pre, vb, post) => {
    const parts = vb.trim().split(/\s+/).map(Number);
    if (parts.length === 4 && parts.every((n: number) => !isNaN(n))) {
      const [x, y, w, h] = parts;
      return `${pre}${x - VB_PAD} ${y - VB_PAD} ${w + VB_PAD * 2} ${h + VB_PAD * 2}${post}`;
    }
    return _m;
  });

  // Defense-in-depth: foreignObject overflow
  cleanedSvg = cleanedSvg.replace(/<foreignObject([^>]*)>/g, (_m, attrs) => {
    let newAttrs = attrs;
    if (/overflow=/.test(newAttrs)) {
      newAttrs = newAttrs.replace(/overflow="[^"]*"/, 'overflow="visible"');
    } else {
      newAttrs += ' overflow="visible"';
    }
    return `<foreignObject${newAttrs}>`;
  });

  return cleanedSvg;
}
