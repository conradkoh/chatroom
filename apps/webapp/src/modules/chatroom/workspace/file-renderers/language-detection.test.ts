import { describe, it, expect } from 'vitest';

import { detectLanguage, fenceLangToSyntheticPath } from './language-detection';

describe('detectLanguage', () => {
  it('detects TypeScript (.ts)', () => {
    expect(detectLanguage('file.ts')).toEqual({ lang: 'ts', isEager: true });
  });

  it('detects TSX (.tsx)', () => {
    expect(detectLanguage('Component.tsx')).toEqual({ lang: 'tsx', isEager: true });
  });

  it('detects JavaScript (.js)', () => {
    expect(detectLanguage('script.js')).toEqual({ lang: 'js', isEager: true });
  });

  it('detects JSX (.jsx)', () => {
    expect(detectLanguage('Component.jsx')).toEqual({ lang: 'jsx', isEager: true });
  });

  it('detects JSON (.json)', () => {
    expect(detectLanguage('package.json')).toEqual({ lang: 'json', isEager: true });
  });

  it('detects Markdown (.md, .mdx, .markdown)', () => {
    expect(detectLanguage('README.md')).toEqual({ lang: 'md', isEager: true });
    expect(detectLanguage('doc.mdx')).toEqual({ lang: 'md', isEager: true });
    expect(detectLanguage('notes.markdown')).toEqual({ lang: 'md', isEager: true });
  });

  it('detects CSS (.css) as lazy', () => {
    expect(detectLanguage('style.css')).toEqual({ lang: 'css', isEager: false });
  });

  it('detects SCSS (.scss) as lazy', () => {
    expect(detectLanguage('vars.scss')).toEqual({ lang: 'scss', isEager: false });
  });

  it('detects HTML (.html, .htm) as lazy', () => {
    expect(detectLanguage('index.html')).toEqual({ lang: 'html', isEager: false });
    expect(detectLanguage('page.htm')).toEqual({ lang: 'html', isEager: false });
  });

  it('detects Python (.py) as lazy', () => {
    expect(detectLanguage('script.py')).toEqual({ lang: 'py', isEager: false });
  });

  it('detects Shell (.sh) as lazy', () => {
    expect(detectLanguage('setup.sh')).toEqual({ lang: 'sh', isEager: false });
  });

  it('detects Bash (.bash) as lazy', () => {
    expect(detectLanguage('run.bash')).toEqual({ lang: 'bash', isEager: false });
  });

  it('detects YAML (.yaml, .yml) as lazy', () => {
    expect(detectLanguage('config.yaml')).toEqual({ lang: 'yaml', isEager: false });
    expect(detectLanguage('ci.yml')).toEqual({ lang: 'yaml', isEager: false });
  });

  it('detects TOML (.toml) as lazy', () => {
    expect(detectLanguage('config.toml')).toEqual({ lang: 'toml', isEager: false });
  });

  it('detects Rust (.rs) as lazy', () => {
    expect(detectLanguage('main.rs')).toEqual({ lang: 'rs', isEager: false });
  });

  it('detects Go (.go) as lazy', () => {
    expect(detectLanguage('main.go')).toEqual({ lang: 'go', isEager: false });
  });

  it('detects SQL (.sql) as lazy', () => {
    expect(detectLanguage('query.sql')).toEqual({ lang: 'sql', isEager: false });
  });

  it('returns null for unknown extensions', () => {
    expect(detectLanguage('data.xyz')).toBeNull();
  });

  it('returns null for files with no extension', () => {
    expect(detectLanguage('Makefile')).toBeNull();
    expect(detectLanguage('Dockerfile')).toBeNull();
  });

  it('is case-insensitive for extensions', () => {
    expect(detectLanguage('Component.TSX')).toEqual({ lang: 'tsx', isEager: true });
    expect(detectLanguage('Config.YAML')).toEqual({ lang: 'yaml', isEager: false });
  });

  it('detects extension from dotfiles', () => {
    expect(detectLanguage('.eslintrc.json')).toEqual({ lang: 'json', isEager: true });
  });

  it('handles paths with multiple dots', () => {
    expect(detectLanguage('test.spec.ts')).toEqual({ lang: 'ts', isEager: true });
    expect(detectLanguage('file.backup.js')).toEqual({ lang: 'js', isEager: true });
  });
});

describe('fenceLangToSyntheticPath', () => {
  it('maps "go" to snippet.go', () => {
    expect(fenceLangToSyntheticPath('go')).toBe('snippet.go');
  });

  it('maps "typescript" to snippet.ts', () => {
    expect(fenceLangToSyntheticPath('typescript')).toBe('snippet.ts');
  });

  it('maps "python" to snippet.py', () => {
    expect(fenceLangToSyntheticPath('python')).toBe('snippet.py');
  });

  it('maps "bash" to snippet.sh', () => {
    expect(fenceLangToSyntheticPath('bash')).toBe('snippet.sh');
  });

  it('maps "yaml" to snippet.yaml', () => {
    expect(fenceLangToSyntheticPath('yaml')).toBe('snippet.yaml');
  });

  it('returns null for unknown fence language', () => {
    expect(fenceLangToSyntheticPath('unknown')).toBeNull();
  });

  it('trims and lowercases the input', () => {
    expect(fenceLangToSyntheticPath('  TypeScript  ')).toBe('snippet.ts');
    expect(fenceLangToSyntheticPath('Go')).toBe('snippet.go');
  });

  it('falls back to raw extension if mapped in EXTENSION_TO_LANG', () => {
    expect(fenceLangToSyntheticPath('.go')).toBe('snippet.go');
  });

  it('maps common aliases correctly', () => {
    expect(fenceLangToSyntheticPath('js')).toBe('snippet.js');
    expect(fenceLangToSyntheticPath('rust')).toBe('snippet.rs');
    expect(fenceLangToSyntheticPath('shell')).toBe('snippet.sh');
    expect(fenceLangToSyntheticPath('golang')).toBe('snippet.go');
    expect(fenceLangToSyntheticPath('css')).toBe('snippet.css');
    expect(fenceLangToSyntheticPath('html')).toBe('snippet.html');
  });
});
