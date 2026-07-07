/**
 * file-icons.tsx
 *
 * Maps file extensions to colorized icons using react-icons/si (Simple Icons)
 * with lucide-react as fallback for extensions without SI coverage.
 */

import { File, FileCode, Terminal } from 'lucide-react';
import type { ComponentType, SVGProps } from 'react';
import {
  SiReact,
  SiTypescript,
  SiJavascript,
  SiJson,
  SiMarkdown,
  SiHtml5,
  SiCss3,
  SiPython,
  SiRust,
  SiGo,
  SiYaml,
} from 'react-icons/si';

// A common icon component type compatible with both react-icons/si and lucide-react
export type FileIconComponent = ComponentType<SVGProps<SVGSVGElement> & { size?: number }>;

export interface FileIconDescriptor {
  Icon: FileIconComponent;
  color?: string;
}

const DEFAULT_ICON: FileIconDescriptor = {
  Icon: File as FileIconComponent,
  color: undefined, // use text-muted-foreground via className
};

const EXTENSION_MAP: Record<string, FileIconDescriptor> = {
  tsx: { Icon: SiReact as FileIconComponent, color: '#61dafb' },
  jsx: { Icon: SiReact as FileIconComponent, color: '#61dafb' },
  ts: { Icon: SiTypescript as FileIconComponent, color: '#3178c6' },
  js: { Icon: SiJavascript as FileIconComponent, color: '#f7df1e' },
  mjs: { Icon: SiJavascript as FileIconComponent, color: '#f7df1e' },
  cjs: { Icon: SiJavascript as FileIconComponent, color: '#f7df1e' },
  json: { Icon: SiJson as FileIconComponent, color: '#cbcb41' },
  md: { Icon: SiMarkdown as FileIconComponent, color: '#519aba' },
  mdx: { Icon: SiMarkdown as FileIconComponent, color: '#519aba' },
  html: { Icon: SiHtml5 as FileIconComponent, color: '#e34f26' },
  css: { Icon: SiCss3 as FileIconComponent, color: '#1572b6' },
  py: { Icon: SiPython as FileIconComponent, color: '#3776ab' },
  rs: { Icon: SiRust as FileIconComponent, color: '#dea584' },
  go: { Icon: SiGo as FileIconComponent, color: '#00add8' },
  yaml: { Icon: SiYaml as FileIconComponent, color: '#cb171e' },
  yml: { Icon: SiYaml as FileIconComponent, color: '#cb171e' },
  sh: { Icon: Terminal as FileIconComponent, color: undefined },
  bash: { Icon: Terminal as FileIconComponent, color: undefined },
  // catch-all for code files without a specific brand icon
  toml: { Icon: FileCode as FileIconComponent, color: undefined },
  xml: { Icon: FileCode as FileIconComponent, color: undefined },
  graphql: { Icon: FileCode as FileIconComponent, color: '#e10098' },
  gql: { Icon: FileCode as FileIconComponent, color: '#e10098' },
  sql: { Icon: FileCode as FileIconComponent, color: undefined },
  scss: { Icon: SiCss3 as FileIconComponent, color: '#c6538c' },
  sass: { Icon: SiCss3 as FileIconComponent, color: '#c6538c' },
};

/**
 * Returns the icon descriptor (component + optional brand color) for a given file path.
 * Falls back to the generic File icon for unknown extensions.
 */
export function getFileIcon(filePath: string): FileIconDescriptor {
  const ext = filePath.split('.').pop()?.toLowerCase() ?? '';
  return EXTENSION_MAP[ext] ?? DEFAULT_ICON;
}
