/**
 * MermaidBlock component tests
 *
 * These tests verify the design patterns and code structure of MermaidBlock,
 * ensuring performance optimizations are maintained:
 * - No React useState for zoom/pan state (uses refs for direct DOM manipulation)
 * - SVG viewBox manipulation instead of CSS transforms
 * - Zoom label updated via ref (not state)
 * - Cross-browser SVG post-processing for Safari compatibility
 */

import fs from 'fs';
import path from 'path';

import { describe, expect, test } from 'vitest';

// Read the source file for static analysis
const SOURCE_PATH = path.join(__dirname, 'MermaidBlock.tsx');
const source = fs.readFileSync(SOURCE_PATH, 'utf-8');

describe('MermaidBlock — performance patterns', () => {
  test('does not use useState for zoom or pan state in the modal', () => {
    // Extract the MermaidFullscreenModal function body
    const modalMatch = source.match(
      /const MermaidFullscreenModal = memo\(function MermaidFullscreenModal\([\s\S]*?\n\}\);/
    );
    expect(modalMatch).not.toBeNull();
    const modalSource = modalMatch![0];

    // Should NOT have useState for zoom, pan, or isPanning
    expect(modalSource).not.toMatch(/useState.*zoom/i);
    expect(modalSource).not.toMatch(/useState.*pan/i);
    expect(modalSource).not.toMatch(/useState.*isPanning/i);

    // SHOULD have useRef for zoom and pan
    expect(modalSource).toMatch(/useRef.*1\)/); // zoomRef = useRef(1)
    expect(modalSource).toMatch(/useRef.*\{ x: 0, y: 0 \}/); // panRef
  });

  test('uses SVG viewBox for zoom instead of CSS transform', () => {
    // The modal should use setAttribute('viewBox', ...) for zoom
    expect(source).toContain("setAttribute('viewBox'");

    // Should NOT use CSS transform: scale() for zoom in the modal
    const modalMatch = source.match(
      /const MermaidFullscreenModal = memo\(function MermaidFullscreenModal\([\s\S]*?\n\}\);/
    );
    const modalSource = modalMatch![0];
    expect(modalSource).not.toContain('transform: `scale');
    expect(modalSource).not.toContain("style.transform");
  });

  test('zoom label uses ref-based DOM mutation instead of React state', () => {
    // Should have zoomLabelRef
    expect(source).toContain('zoomLabelRef');
    expect(source).toContain('ref={zoomLabelRef}');

    // Should update via textContent, not setState
    expect(source).toContain('.textContent =');

    // Should NOT have setZoomDisplay in the modal
    const modalMatch = source.match(
      /const MermaidFullscreenModal = memo\(function MermaidFullscreenModal\([\s\S]*?\n\}\);/
    );
    const modalSource = modalMatch![0];
    expect(modalSource).not.toContain('setZoomDisplay');
  });

  test('removes mermaid inline max-width constraint on SVG', () => {
    // Should remove mermaid's max-width constraint for proper centering
    expect(source).toContain("style.maxWidth = 'none'");
  });

  test('uses preserveAspectRatio for SVG centering', () => {
    expect(source).toContain("'preserveAspectRatio', 'xMidYMid meet'");
  });

  test('uses requestAnimationFrame for batched updates', () => {
    expect(source).toContain('requestAnimationFrame');
    expect(source).toContain('cancelAnimationFrame');
  });

  test('uses native event listeners (not React synthetic events) for interactions', () => {
    // Native addEventListener calls
    expect(source).toContain("addEventListener('wheel'");
    expect(source).toContain("addEventListener('mousedown'");
    expect(source).toContain("addEventListener('mousemove'");
    expect(source).toContain("addEventListener('touchstart'");
    expect(source).toContain("addEventListener('touchmove'");

    // Wheel listener should be non-passive to allow preventDefault
    expect(source).toContain("passive: false");
  });
});

describe('MermaidBlock — cross-browser text alignment', () => {
  test('defines recenterNodeLabels using screen-space measurements', () => {
    // Should use screen-space getBoundingClientRect (not getBBox)
    expect(source).toContain('getBoundingClientRect()');
    // Should use getScreenCTM for coordinate conversion
    expect(source).toContain('getScreenCTM()');
    // Should have a threshold guard (1px)
    expect(source).toContain('Math.abs(screenDeltaY) <= 1.0');
  });

  test('applies re-centering in both main component and fullscreen modal', () => {
    const mainMatch = source.match(
      /export const MermaidBlock = memo\(function MermaidBlock\([\s\S]*?\n\}\);/
    );
    expect(mainMatch).not.toBeNull();
    expect(mainMatch![0]).toContain('recenterNodeLabels');

    const modalMatch = source.match(
      /const MermaidFullscreenModal = memo\(function MermaidFullscreenModal\([\s\S]*?\n\}\);/
    );
    expect(modalMatch).not.toBeNull();
    expect(modalMatch![0]).toContain('recenterNodeLabels');
  });
});

describe('MermaidBlock — structure', () => {
  test('exports MermaidBlock as a named memo export', () => {
    expect(source).toContain('export const MermaidBlock = memo(');
  });

  test('has an expand button for fullscreen', () => {
    expect(source).toContain('Maximize2');
    expect(source).toContain('View fullscreen');
  });

  test('renders MermaidFullscreenModal with isOpen/onClose props', () => {
    expect(source).toContain('<MermaidFullscreenModal');
    expect(source).toContain('isOpen={isModalOpen}');
    expect(source).toContain('onClose={');
  });

  test('uses createPortal for modal rendering', () => {
    expect(source).toContain('createPortal');
    expect(source).toContain('document.body');
  });

  test('supports keyboard (Escape) and backdrop click to close', () => {
    expect(source).toContain("e.key === 'Escape'");
    expect(source).toContain('handleBackdropClick');
  });
});

// ─── Mermaid Configuration Tests ─────────────────────────────────────────────

describe('MermaidBlock — mermaid configuration', () => {
  test('htmlLabels is set at the top level (not nested under flowchart)', () => {
    // In Mermaid 11.x, flowchart.htmlLabels is deprecated.
    // The setting must be at the top level of mermaid.initialize().
    // Extract the mermaid.initialize call
    const initMatch = source.match(
      /mermaid\.initialize\(\{[\s\S]*?\}\);/
    );
    expect(initMatch).not.toBeNull();
    const initBlock = initMatch![0];

    // htmlLabels: false should appear BEFORE the flowchart block
    const htmlLabelsIdx = initBlock.indexOf('htmlLabels: false');
    const flowchartIdx = initBlock.indexOf('flowchart:');
    expect(htmlLabelsIdx).toBeGreaterThan(-1);
    expect(flowchartIdx).toBeGreaterThan(-1);
    // htmlLabels must come before flowchart (top-level, not nested)
    expect(htmlLabelsIdx).toBeLessThan(flowchartIdx);
  });

  test('htmlLabels is not set inside the flowchart config block', () => {
    // Extract just the flowchart config object
    const flowchartMatch = source.match(
      /flowchart:\s*\{[\s\S]*?\},/
    );
    expect(flowchartMatch).not.toBeNull();
    const flowchartBlock = flowchartMatch![0];

    // flowchart block should NOT contain htmlLabels
    expect(flowchartBlock).not.toContain('htmlLabels');
  });

  test('useMaxWidth is set to false for natural sizing', () => {
    const flowchartMatch = source.match(
      /flowchart:\s*\{[\s\S]*?\},/
    );
    expect(flowchartMatch).not.toBeNull();
    expect(flowchartMatch![0]).toContain('useMaxWidth: false');
  });

  test('node padding is increased for polished appearance', () => {
    const flowchartMatch = source.match(
      /flowchart:\s*\{[\s\S]*?\},/
    );
    expect(flowchartMatch).not.toBeNull();
    // padding should be >= 20 (default is 15)
    const paddingMatch = flowchartMatch![0].match(/padding:\s*(\d+)/);
    expect(paddingMatch).not.toBeNull();
    expect(Number(paddingMatch![1])).toBeGreaterThanOrEqual(20);
  });

  test('wrappingWidth is set to 500 to prevent excessive wrapping', () => {
    expect(source).toContain('wrappingWidth: 500');
  });
});

// ─── SVG Post-Processing Tests ───────────────────────────────────────────────

describe('MermaidBlock — SVG post-processing', () => {
  // Extract the renderChart function body for analysis
  const renderChartMatch = source.match(
    /async function renderChart\(\)\s*\{[\s\S]*?\n\s{4}\}/
  );
  const renderChartBody = renderChartMatch ? renderChartMatch[0] : '';

  test('removes max-width from SVG inline style', () => {
    // Should have a regex that strips max-width from the SVG style attribute
    expect(renderChartBody).toContain('max-width:');
    expect(renderChartBody).toMatch(/cleanedSvg\s*=\s*cleanedSvg\.replace/);
  });

  test('forces overflow="visible" on the root SVG element', () => {
    // Should add or replace overflow attribute on <svg>
    expect(renderChartBody).toContain('overflow="visible"');
    // Should handle both cases: existing overflow attr and missing one
    expect(renderChartBody).toMatch(/overflow="[^"]*"/);
  });

  test('pads the viewBox for Safari text metric differences', () => {
    // Should have VB_PAD constant and viewBox manipulation
    expect(renderChartBody).toContain('VB_PAD');
    expect(renderChartBody).toContain('viewBox');
    // Should subtract padding from x,y and add 2*padding to width,height
    expect(renderChartBody).toContain('x - VB_PAD');
    expect(renderChartBody).toContain('y - VB_PAD');
    expect(renderChartBody).toContain('w + VB_PAD * 2');
    expect(renderChartBody).toContain('h + VB_PAD * 2');
  });

  test('adds overflow="visible" to foreignObject elements (defense-in-depth)', () => {
    // Should post-process foreignObject elements for Safari compatibility
    expect(renderChartBody).toContain('<foreignObject');
    expect(renderChartBody).toContain('foreignObject');
    // Should add overflow="visible" to each foreignObject
    expect(renderChartBody).toMatch(new RegExp('foreignObject.*overflow', 's'));
  });

  test('inline container has overflow-visible CSS for SVG children', () => {
    // The container div should have [&_svg]:overflow-visible
    expect(source).toContain('[&_svg]:overflow-visible');
  });

  test('inline container has padding for polished appearance', () => {
    // The container div for the inline diagram should have padding
    expect(source).toMatch(/className="[^"]*p-\d/);
  });
});
