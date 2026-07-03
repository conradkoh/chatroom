/**
 * Domain types for workspace file tree and file content.
 *
 * The file tree is stored as a single JSON blob per workspace
 * (machineId + workingDir) to avoid expensive full-tree queries.
 * File content is fetched on-demand and cached separately.
 */

/** A single entry in the file tree (file or directory). */
export type FileTreeEntry = {
  path: string;
  type: 'file' | 'directory';
  size?: number;
  modifiedAt?: number;
};

/** The complete file tree for a workspace. */
export type FileTree = {
  entries: FileTreeEntry[];
  scannedAt: number;
  rootDir: string;
};

/** On-demand file content for a single file. */
export type FileContent = {
  path: string;
  content: string;
  encoding: 'utf8';
  truncated: boolean;
};

/** A single entry returned by listDir (immediate children only). */
export type DirListingEntry = {
  name: string;
  path: string;
  type: 'file' | 'directory';
  size?: number;
};

/** Directory listing for one path (dirPath '' = workspace root). */
export type DirListing = {
  dirPath: string;
  entries: DirListingEntry[];
  scannedAt: number;
  truncated: boolean;
  totalCount: number;
};

/** File search results (flat file paths only). */
export type FileSearchResult = {
  query: string;
  entries: { path: string; type: 'file' }[];
  scannedAt: number;
  truncated: boolean;
  totalCount: number;
};
