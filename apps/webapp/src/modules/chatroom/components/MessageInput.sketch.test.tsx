import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { MessageInput } from './MessageInput';
import { AttachmentsProvider } from '../attachments';

Object.defineProperty(window, 'matchMedia', {
  configurable: true,
  value: () => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() }),
});
vi.mock('convex-helpers/react/sessions', () => ({ useSessionMutation: () => vi.fn() }));
const attachFiles = vi.fn();
vi.mock('../hooks/useChatInputFileDrop', () => ({
  useChatInputFileDrop: () => ({
    uploadJobs: [],
    isDragging: false,
    handleDragEnter: vi.fn(),
    handleDragLeave: vi.fn(),
    handleDragOver: vi.fn(),
    handleDrop: vi.fn(),
    fileInputRef: { current: null },
    handleAttachClick: vi.fn(),
    handleFileInputChange: vi.fn(),
    handlePaste: vi.fn(),
    attachFiles,
    canUndo: false,
    canRedo: false,
    undo: vi.fn(),
    redo: vi.fn(),
  }),
}));
vi.mock('./composer/useSketchDocument', () => ({
  useSketchDocument: () => ({
    canvasRef: { current: document.createElement('canvas') },
    canvasBindings: {},
    hasContent: true,
    exportPngFile: () =>
      Promise.resolve(new File(['png'], 'sketch-20260816-120000.png', { type: 'image/png' })),
  }),
}));
describe('MessageInput sketch integration', () => {
  it('confirms a sketch through attachFiles', async () => {
    render(
      <AttachmentsProvider>
        <MessageInput chatroomId="chatroom-1" machineId="m1" workingDir="/ws" />
      </AttachmentsProvider>
    );
    await userEvent.click(screen.getByRole('button', { name: 'Add attachment' }));
    await userEvent.click(screen.getByText('Sketch'));
    await userEvent.click(screen.getByRole('button', { name: 'Add sketch' }));
    expect(attachFiles).toHaveBeenCalledWith([
      expect.objectContaining({
        type: 'image/png',
        name: expect.stringMatching(/^sketch-.*\.png$/),
      }),
    ]);
  });
});
