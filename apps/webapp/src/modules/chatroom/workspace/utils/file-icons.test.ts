/**
 * Unit tests for getFileIcon helper.
 */

import { describe, it, expect } from 'vitest';
import { getFileIcon } from './file-icons';

describe('getFileIcon', () => {
  it('returns React icon for .tsx files', () => {
    const { Icon, color } = getFileIcon('src/App.tsx');
    expect(Icon).toBeDefined();
    expect(color).toBe('#61dafb');
  });

  it('returns React icon for .jsx files', () => {
    const { color } = getFileIcon('Component.jsx');
    expect(color).toBe('#61dafb');
  });

  it('returns TypeScript icon for .ts files', () => {
    const { color } = getFileIcon('index.ts');
    expect(color).toBe('#3178c6');
  });

  it('returns JavaScript icon for .js files', () => {
    const { color } = getFileIcon('script.js');
    expect(color).toBe('#f7df1e');
  });

  it('returns JavaScript icon for .mjs and .cjs files', () => {
    expect(getFileIcon('mod.mjs').color).toBe('#f7df1e');
    expect(getFileIcon('mod.cjs').color).toBe('#f7df1e');
  });

  it('returns JSON icon for .json files', () => {
    const { color } = getFileIcon('package.json');
    expect(color).toBe('#cbcb41');
  });

  it('returns Markdown icon for .md and .mdx files', () => {
    expect(getFileIcon('README.md').color).toBe('#519aba');
    expect(getFileIcon('docs.mdx').color).toBe('#519aba');
  });

  it('returns HTML icon for .html files', () => {
    const { color } = getFileIcon('index.html');
    expect(color).toBe('#e34f26');
  });

  it('returns CSS icon for .css files', () => {
    const { color } = getFileIcon('style.css');
    expect(color).toBe('#1572b6');
  });

  it('returns Python icon for .py files', () => {
    const { color } = getFileIcon('script.py');
    expect(color).toBe('#3776ab');
  });

  it('returns Rust icon for .rs files', () => {
    const { color } = getFileIcon('main.rs');
    expect(color).toBe('#dea584');
  });

  it('returns Go icon for .go files', () => {
    const { color } = getFileIcon('main.go');
    expect(color).toBe('#00add8');
  });

  it('returns YAML icon for .yaml and .yml files', () => {
    expect(getFileIcon('config.yaml').color).toBe('#cb171e');
    expect(getFileIcon('ci.yml').color).toBe('#cb171e');
  });

  it('returns default File icon (no color) for unknown extensions', () => {
    const { color } = getFileIcon('data.xyz');
    expect(color).toBeUndefined();
  });

  it('returns default File icon for files with no extension', () => {
    const { color } = getFileIcon('Makefile');
    expect(color).toBeUndefined();
  });

  it('is case-insensitive for extensions', () => {
    const { color } = getFileIcon('Component.TSX');
    expect(color).toBe('#61dafb');
  });
});
