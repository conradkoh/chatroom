import { describe, expect, it } from 'vitest';

import {
  chatroomExportFailure,
  chatroomExportSuccess,
  chatroomExportingLabel,
  importFailureNote,
  importRejectCopy,
  importResultTitle,
  importSummaryLine,
  importingChunkCopy,
  machineExportFailure,
  machineExportSuccess,
  machineExportingLabel,
  omittedAttachmentsCopy,
} from './transferCopy';

describe('chatroomExportingLabel', () => {
  it('names the chatroom being exported', () => {
    expect(chatroomExportingLabel('Planning room')).toBe('Exporting “Planning room”…');
  });

  it('falls back to Untitled chatroom for a missing or blank name', () => {
    expect(chatroomExportingLabel(null)).toBe('Exporting “Untitled chatroom”…');
    expect(chatroomExportingLabel('   ')).toBe('Exporting “Untitled chatroom”…');
  });
});

describe('machineExportingLabel', () => {
  it('shows the chatroom being written, capped at the total', () => {
    expect(machineExportingLabel(0, 3)).toBe('Exporting 1 of 3 chatrooms…');
    expect(machineExportingLabel(1, 3)).toBe('Exporting 2 of 3 chatrooms…');
    expect(machineExportingLabel(2, 3)).toBe('Exporting 3 of 3 chatrooms…');
    expect(machineExportingLabel(3, 3)).toBe('Exporting 3 of 3 chatrooms…');
  });

  it('uses the singular for a one-chatroom bundle', () => {
    expect(machineExportingLabel(0, 1)).toBe('Exporting 1 of 1 chatroom…');
  });
});

describe('chatroomExportSuccess', () => {
  const fileName = 'chatroom-chr-1-20260102T030405Z.json';

  it('reports the file name and no items when nothing was omitted', () => {
    expect(
      chatroomExportSuccess({ name: 'Planning room', fileName, omitted: { count: 0, bytes: 0 } })
    ).toEqual({ message: `Exported “Planning room” to ${fileName}.` });
  });

  it('renders one omitted attachment with its size', () => {
    expect(
      chatroomExportSuccess({ name: 'Planning room', fileName, omitted: { count: 1, bytes: 1024 } })
    ).toEqual({
      message: `Exported “Planning room” to ${fileName}.`,
      items: ['1 attachment not included (1 KB)'],
    });
  });

  it('renders several omitted attachments with their total size', () => {
    expect(
      chatroomExportSuccess({
        name: null,
        fileName,
        omitted: { count: 3, bytes: 4_404_019 },
      })
    ).toEqual({
      message: `Exported “Untitled chatroom” to ${fileName}.`,
      items: ['3 attachments not included (4.2 MB)'],
    });
  });

  it('reports a capped attachment count as more than 1000', () => {
    expect(
      chatroomExportSuccess({
        name: 'Planning room',
        fileName,
        omitted: { count: 1001, bytes: 0 },
      })
    ).toEqual({
      message: `Exported “Planning room” to ${fileName}.`,
      items: ['more than 1000 attachments not included (0 B)'],
    });
  });
});

describe('chatroomExportFailure', () => {
  it('offers a retry when the chatroom changed', () => {
    expect(
      chatroomExportFailure({ code: 'EXPORT_CHATROOM_CHANGED', message: 'changed', details: [] })
    ).toEqual({
      title: 'Export failed',
      message: 'This chatroom changed while exporting. Try again.',
      retryable: true,
    });
  });

  it('explains the 256 MB limit without offering a retry', () => {
    expect(
      chatroomExportFailure({ code: 'EXPORT_TOO_LARGE', message: 'too large', details: [] })
    ).toEqual({
      title: 'Export failed',
      message: 'The export is larger than the 256 MB limit and cannot be saved as one file.',
      retryable: false,
    });
  });

  it('falls back to a generic retryable failure', () => {
    expect(chatroomExportFailure({ code: 'UNKNOWN', message: 'boom', details: [] })).toEqual({
      title: 'Export failed',
      message: 'Could not export. Try again.',
      retryable: true,
    });
  });
});

describe('machineExportSuccess', () => {
  it('lists the chatroom count and any omitted attachments', () => {
    expect(
      machineExportSuccess({
        fileName: 'chatroom-all-machine-1-20260102T030405Z.json',
        chatroomCount: 2,
        omitted: { count: 2, bytes: 2048 },
      })
    ).toEqual({
      message: 'Saved chatroom-all-machine-1-20260102T030405Z.json',
      items: ['2 chatrooms', '2 attachments not included (2 KB)'],
    });
  });

  it('uses the singular for one chatroom and omits a zero attachment line', () => {
    expect(
      machineExportSuccess({
        fileName: 'chatroom-all-machine-1-20260102T030405Z.json',
        chatroomCount: 1,
        omitted: { count: 0, bytes: 0 },
      })
    ).toEqual({
      message: 'Saved chatroom-all-machine-1-20260102T030405Z.json',
      items: ['1 chatroom'],
    });
  });
});

describe('machineExportFailure', () => {
  it('lists the failed chatroom names for an incomplete export', () => {
    expect(
      machineExportFailure(
        { code: 'EXPORT_ALL_INCOMPLETE', message: 'incomplete', details: [] },
        [{ name: 'Alpha' }, { name: null }],
        12
      )
    ).toEqual({
      title: 'Export incomplete — no file was saved',
      message: '2 of 12 chatrooms could not be exported:',
      items: ['Alpha', 'Untitled chatroom'],
      retryable: true,
    });
  });

  it('caps the names at five and adds a remainder line', () => {
    expect(
      machineExportFailure(
        { code: 'EXPORT_ALL_INCOMPLETE', message: 'incomplete', details: [] },
        [
          { name: 'One' },
          { name: 'Two' },
          { name: 'Three' },
          { name: 'Four' },
          { name: 'Five' },
          { name: 'Six' },
          { name: 'Seven' },
        ],
        12
      )
    ).toEqual({
      title: 'Export incomplete — no file was saved',
      message: '7 of 12 chatrooms could not be exported:',
      items: ['One', 'Two', 'Three', 'Four', 'Five', 'and 2 more'],
      retryable: true,
    });
  });

  it('uses the singular when the only chatroom failed', () => {
    expect(
      machineExportFailure(
        { code: 'EXPORT_ALL_INCOMPLETE', message: 'incomplete', details: [] },
        [{ name: 'Alpha' }],
        1
      )
    ).toEqual({
      title: 'Export incomplete — no file was saved',
      message: '1 of 1 chatroom could not be exported:',
      items: ['Alpha'],
      retryable: true,
    });
  });

  it('explains the bundle limit and the machine workspace cap', () => {
    expect(
      machineExportFailure({ code: 'EXPORT_TOO_LARGE', message: 'too large', details: [] }, [], 3)
    ).toEqual({
      title: 'Export failed',
      message: 'The bundle is larger than the 256 MB limit and cannot be saved as one file.',
      retryable: false,
    });
    expect(
      machineExportFailure(
        { code: 'EXPORT_MACHINE_TOO_LARGE', message: 'too many', details: [] },
        [],
        0
      )
    ).toEqual({
      title: 'Export failed',
      message: 'This machine has too many workspaces to export at once.',
      retryable: false,
    });
  });

  it('describes a changed chatroom and falls back for anything else', () => {
    expect(
      machineExportFailure(
        { code: 'EXPORT_CHATROOM_CHANGED', message: 'changed', details: [] },
        [],
        3
      )
    ).toEqual({
      title: 'Export failed',
      message: 'A chatroom changed while exporting. Try again.',
      retryable: true,
    });
    expect(machineExportFailure({ code: 'UNKNOWN', message: 'boom', details: [] }, [], 3)).toEqual({
      title: 'Export failed',
      message: 'Could not export. Try again.',
      retryable: true,
    });
  });
});

describe('importRejectCopy', () => {
  it('names the file size and the limit for an oversize file', () => {
    expect(importRejectCopy('IMPORT_FILE_TOO_LARGE', 'too large', 300_000_000)).toBe(
      'This file is 286.1 MB. The limit is 256 MB.'
    );
  });

  it('names only the limit when the size is unknown', () => {
    expect(importRejectCopy('IMPORT_FILE_TOO_LARGE', 'too large')).toBe(
      'This file is larger than the 256 MB limit.'
    );
  });

  it('maps every file-level code to its copy', () => {
    expect(importRejectCopy('IMPORT_FILE_UNREADABLE', 'raw')).toBe(
      'This file is not valid JSON or could not be read.'
    );
    expect(importRejectCopy('IMPORT_NOT_AN_EXPORT', 'raw')).toBe(
      'This is not a chatroom export file.'
    );
    expect(importRejectCopy('IMPORT_UNSUPPORTED_VERSION', 'raw')).toBe(
      'This export uses a format version this app does not support. Re-export it with a matching version.'
    );
    expect(importRejectCopy('IMPORT_CHECKSUM_MISMATCH', 'raw')).toBe(
      'The file was changed or damaged after it was exported (checksum mismatch).'
    );
  });

  it('falls back to the parser message for any other code', () => {
    expect(importRejectCopy('SOMETHING_ELSE', 'the raw message')).toBe('the raw message');
  });
});

describe('importResultTitle', () => {
  it('reads complete, with errors, or stopped', () => {
    expect(importResultTitle({ failed: 0, cancelled: false, fatal: false })).toBe(
      'Import complete'
    );
    expect(importResultTitle({ failed: 2, cancelled: false, fatal: false })).toBe(
      'Import finished with errors'
    );
    expect(importResultTitle({ failed: 0, cancelled: true, fatal: false })).toBe('Import stopped');
    expect(importResultTitle({ failed: 3, cancelled: false, fatal: true })).toBe('Import stopped');
  });
});

describe('importSummaryLine', () => {
  it('always keeps the imported segment and omits zero failure segments', () => {
    expect(importSummaryLine({ imported: 7, selected: 10, failed: 0, skipped: 0 })).toBe(
      'Imported 7 of 10 selected'
    );
    expect(importSummaryLine({ imported: 0, selected: 3, failed: 0, skipped: 0 })).toBe(
      'Imported 0 of 3 selected'
    );
  });

  it('appends failures and skips in order', () => {
    expect(importSummaryLine({ imported: 7, selected: 10, failed: 1, skipped: 2 })).toBe(
      'Imported 7 of 10 selected · Failed 1 · Not started 2'
    );
    expect(importSummaryLine({ imported: 6, selected: 7, failed: 1, skipped: 0 })).toBe(
      'Imported 6 of 7 selected · Failed 1'
    );
  });
});

describe('import row copy', () => {
  it('explains what happened to a failed row', () => {
    expect(importFailureNote({ rolledBack: true })).toBe('Rolled back — nothing was kept.');
    expect(importFailureNote({ rolledBack: false })).toBe('Nothing was created.');
    expect(importFailureNote({ rolledBack: false, orphanChatroomId: 'room-1' })).toBe(
      'Rollback failed. Chatroom room-1 may be incomplete.'
    );
  });

  it('formats chunk progress and refuses a zero-total line', () => {
    expect(importingChunkCopy(3, 12)).toBe('Importing… part 3 of 12');
    expect(importingChunkCopy(0, 0)).toBe('Importing…');
  });

  it('caps an attachment count at more than 1000', () => {
    expect(omittedAttachmentsCopy(1)).toBe('1 attachment not included');
    expect(omittedAttachmentsCopy(3)).toBe('3 attachments not included');
    expect(omittedAttachmentsCopy(1001)).toBe('more than 1000 attachments not included');
  });
});
