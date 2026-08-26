import type { useRequestWorkspaceFileContent } from './useRequestWorkspaceFileContent';
import {
  isFileNotFoundError,
  isPendingOptimisticNewFile,
  isTransientNewFileReadError,
  isWorkspaceNotRegisteredError,
} from '../utils/fileContentSentinels';

export type LoadedContent = ReturnType<typeof useRequestWorkspaceFileContent>;

export function resolveLoadedServerContent(
  loadedContent: LoadedContent,
  filePath: string,
  initialEmpty: boolean
): string | null | undefined {
  if (loadedContent === undefined) return undefined;
  if (loadedContent === null) return resolveEmptyContent(filePath, initialEmpty);
  return resolveDefinedServerContent(loadedContent, filePath);
}

function resolveDefinedServerContent(
  loadedContent: Exclude<LoadedContent, null | undefined>,
  filePath: string
): string | null {
  if (isTransientNewFileReadError(loadedContent.content, filePath)) return '';
  if (isWorkspaceNotRegisteredError(loadedContent.content)) return null;
  if (isFileNotFoundError(loadedContent.content)) return null;
  return loadedContent.content;
}

function resolveEmptyContent(filePath: string, initialEmpty: boolean): '' | null {
  return initialEmpty || isPendingOptimisticNewFile(filePath) ? '' : null;
}

function workspaceRegistrationError(content: string | undefined): string | null {
  return content && isWorkspaceNotRegisteredError(content)
    ? 'Workspace is not registered on this machine.'
    : null;
}

function fileNotFoundError(content: string | undefined): string | null {
  return content && isFileNotFoundError(content) ? 'File not found.' : null;
}

function resolveLoadError(
  serverContent: string | null | undefined,
  loadedContent: LoadedContent
): string | null {
  if (serverContent !== null || !loadedContent?.content) return null;
  return resolveContentError(loadedContent.content);
}

function resolveContentError(content: string): string | null {
  return workspaceRegistrationError(content) ?? fileNotFoundError(content);
}

function isAwaitingInitialContent(loadedContent: LoadedContent, filePath: string): boolean {
  if (loadedContent === undefined || loadedContent === null) return true;
  return isTransientNewFileReadError(loadedContent.content, filePath);
}

export function resolveEditorLoadState(
  serverContent: string | null | undefined,
  loadedContent: LoadedContent,
  filePath: string,
  treatAsOptimisticEmpty: boolean
) {
  const loadError = resolveLoadError(serverContent, loadedContent);
  return {
    loadError,
    isLoading:
      !loadError && !treatAsOptimisticEmpty && isAwaitingInitialContent(loadedContent, filePath),
  };
}
