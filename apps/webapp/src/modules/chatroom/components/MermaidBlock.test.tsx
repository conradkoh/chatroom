/**
 * MermaidBlock component tests
 *
 * These tests verify the design patterns and code structure of MermaidBlock,
 * ensuring performance optimizations are maintained:
 * - No React useState for zoom/pan state (uses refs for direct DOM manipulation)
 * - SVG viewBox manipulation instead of CSS transforms
 * - Zoom label updated via ref (not state)
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
  test('uses CSS dominant-baseline for SVG text vertical centering', () => {
    // Should use dominant-baseline CSS property for cross-browser text alignment
    expect(source).toContain('dominant-baseline');
    // Should NOT use JavaScript-based recenterNodeLabels function (removed)
    expect(source).not.toContain('recenterNodeLabels');
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
