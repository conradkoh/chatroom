import {
  Braces,
  Code2,
  File,
  FileCode,
  FileText,
  Globe,
  Image,
  Lock,
  Palette,
  Settings,
  Terminal,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

/** Map of file extensions to lucide-react icon components. */
const EXTENSION_ICON_MAP: Record<string, LucideIcon> = {
  // TypeScript / JavaScript
  '.ts': Code2,
  '.tsx': Code2,
  '.js': Braces,
  '.jsx': Braces,
  '.mjs': Braces,
  '.cjs': Braces,

  // Data / Config
  '.json': Braces,
  '.yml': Settings,
  '.yaml': Settings,
  '.toml': Settings,

  // Markup / Docs
  '.md': FileText,
  '.mdx': FileText,
  '.txt': FileText,
  '.html': Globe,
  '.htm': Globe,

  // Styles
  '.css': Palette,
  '.scss': Palette,
  '.sass': Palette,
  '.less': Palette,

  // Other languages
  '.py': FileCode,
  '.rs': FileCode,
  '.go': FileCode,
  '.rb': FileCode,
  '.java': FileCode,
  '.c': FileCode,
  '.cpp': FileCode,
  '.h': FileCode,

  // Shell / Config
  '.sh': Terminal,
  '.bash': Terminal,
  '.zsh': Terminal,
  '.env': Lock,
  '.env.local': Lock,

  // Images
  '.svg': Image,
  '.png': Image,
  '.jpg': Image,
  '.jpeg': Image,
  '.gif': Image,
  '.webp': Image,
  '.ico': Image,
};

/**
 * Returns the appropriate lucide-react icon component for a file path.
 * Falls back to generic File icon for unknown extensions.
 */
export function getFileIcon(path: string): LucideIcon {
  const lastDot = path.lastIndexOf('.');
  if (lastDot === -1) return File;
  const ext = path.slice(lastDot).toLowerCase();
  return EXTENSION_ICON_MAP[ext] ?? File;
}
