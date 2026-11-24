import { isBinaryFile } from '../../components/FileSelector/binaryDetection';
import { isMarkdownFile } from '../file-renderers';
import type { WorkspaceFileContentStatus } from './types';
import {
  FILE_BINARY_PLACEHOLDER,
  FILE_BLOCKED_PLACEHOLDER_PREFIX,
  FILE_READ_ERROR_PLACEHOLDER,
  isFileNotFoundError,
  isWorkspaceNotRegisteredError,
} from '../utils/fileContentSentinels';

/** Single source for every disabled-download reason. The resolver is the only reader. */
const FILE_DOWNLOAD_REASON = {
  loading: 'Loading file content…',
  truncated: 'File is larger than the 500 KB preview limit.',
  binary: 'Binary files cannot be downloaded.',
  notFound: 'File not found.',
  blocked: 'This file is blocked from reading.',
  readError: 'Could not read this file.',
  workspaceUnavailable: 'The workspace is not available.',
  unavailable: 'File content is unavailable.',
} as const;

export type FileDownloadAvailability =
  { kind: 'hidden' } | { kind: 'ready' } | { kind: 'disabled'; reason: string };

export interface FileDownloadAvailabilityInput {
  filePath: string;
  nodeType?: 'file' | 'directory';
  status?: WorkspaceFileContentStatus;
  content?: string | null;
  truncated?: boolean;
  isBinary?: boolean;
}

function disabled(reason: string): FileDownloadAvailability {
  return { kind: 'disabled', reason };
}

/**
 * Order matters: directory/non-markdown hides, binary disables, loading and not-found disable,
 * truncation beats any placeholder, then exact daemon placeholders map to their reason, then
 * null/undefined content is unavailable. `''` is ready (empty files export).
 *
 * One intentional priority ladder, not decomposable without losing the ordering contract.
 */
// fallow-ignore-next-line complexity
export function resolveFileDownloadAvailability(
  input: FileDownloadAvailabilityInput
): FileDownloadAvailability {
  const { filePath, nodeType, status = 'ready', content, truncated, isBinary } = input;
  if (nodeType === 'directory' || !isMarkdownFile(filePath)) return { kind: 'hidden' };
  if (isBinary ?? isBinaryFile(filePath)) return disabled(FILE_DOWNLOAD_REASON.binary);
  if (status === 'loading') return disabled(FILE_DOWNLOAD_REASON.loading);
  if (status === 'not-found') return disabled(FILE_DOWNLOAD_REASON.notFound);
  if (truncated) return disabled(FILE_DOWNLOAD_REASON.truncated);
  if (typeof content === 'string') {
    if (content === FILE_BINARY_PLACEHOLDER) return disabled(FILE_DOWNLOAD_REASON.binary);
    if (isFileNotFoundError(content)) return disabled(FILE_DOWNLOAD_REASON.notFound);
    if (content.startsWith(FILE_BLOCKED_PLACEHOLDER_PREFIX)) {
      return disabled(FILE_DOWNLOAD_REASON.blocked);
    }
    if (content === FILE_READ_ERROR_PLACEHOLDER) return disabled(FILE_DOWNLOAD_REASON.readError);
    if (isWorkspaceNotRegisteredError(content)) {
      return disabled(FILE_DOWNLOAD_REASON.workspaceUnavailable);
    }
    return { kind: 'ready' };
  }
  return disabled(FILE_DOWNLOAD_REASON.unavailable);
}
