/**
 * Native folder picker dialog for daemon-initiated workspace selection.
 */

import { execFileSync } from 'node:child_process';

export type PickFolderResult =
  | { success: true; path: string }
  | { success: false; error: string; cancelled?: boolean };

// fallow-ignore-next-line complexity
function runPicker(command: string, args: string[]): PickFolderResult {
  try {
    const path = execFileSync(command, args, { encoding: 'utf8', timeout: 300_000 }).trim();
    if (!path) return { success: false, error: 'No folder selected' };
    return { success: true, path };
  } catch (error) {
    const exitCode =
      typeof error === 'object' && error !== null && 'status' in error ? error.status : null;
    if (exitCode === 1) return { success: false, error: 'Cancelled', cancelled: true };
    const message = error instanceof Error ? error.message : String(error);
    return { success: false, error: message };
  }
}

/** Open a native folder picker dialog and return the selected path. */
// fallow-ignore-next-line complexity
export function pickFolderDialog(): PickFolderResult {
  switch (process.platform) {
    case 'darwin':
      return runPicker('osascript', [
        '-e',
        'POSIX path of (choose folder with prompt "Select workspace folder")',
      ]);
    case 'win32':
      return runPicker('powershell', [
        '-NoProfile',
        '-Command',
        [
          'Add-Type -AssemblyName System.Windows.Forms',
          '$dialog = New-Object System.Windows.Forms.FolderBrowserDialog',
          '$dialog.Description = "Select workspace folder"',
          'if ($dialog.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) {',
          '  Write-Output $dialog.SelectedPath',
          '  exit 0',
          '}',
          'exit 1',
        ].join('; '),
      ]);
    default:
      return runPicker('zenity', [
        '--file-selection',
        '--directory',
        '--title=Select workspace folder',
      ]);
  }
}
