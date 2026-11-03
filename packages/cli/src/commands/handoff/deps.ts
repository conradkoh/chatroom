/** Handoff Deps — dependency interfaces for the handoff command. */

import type { BackendOps, SessionOps } from '../../infrastructure/deps/index.js';

export type HandoffResult = {
  success: boolean;
  error?:
    | {
        message: string;
        code?: string | undefined;
        suggestedTarget?: string | undefined;
        suggestedTargets?: string[] | undefined;
      }
    | undefined;
  supportsNativeIntegration?: boolean | undefined;
  newTaskId?: string | null | undefined;
};

export interface HandoffGatewayOps {
  handoff(args: {
    sessionId: string;
    chatroomId: string;
    senderRole: string;
    content: string;
    targetRole: string;
    /** Bound attachment ids, in the order the files were supplied. */
    attachedFileIds?: string[] | undefined;
  }): Promise<HandoffResult>;
}

/**
 * Port for the file-attachment upload lifecycle.
 *
 * The CLI uploads bytes straight to the URL returned by `beginUpload`; bytes
 * never pass through the daemon socket or the handoff gateway. `uploadBytes`
 * throws `FileAttachmentUploadError` when the HTTP action rejects the upload.
 */
export interface FileAttachmentUploaderOps {
  beginUpload(args: {
    sessionId: string;
    chatroomId: string;
    senderRole: string;
    filename: string;
    sizeBytes: number;
  }): Promise<{ attachmentId: string; uploadUrl: string }>;
  uploadBytes(args: {
    sessionId: string;
    attachmentId: string;
    uploadUrl: string;
    bytes: Uint8Array;
  }): Promise<void>;
  discardUploads(args: { sessionId: string; attachmentIds: string[] }): Promise<void>;
}

/** Structured failure returned by the upload HTTP action. */
export class FileAttachmentUploadError extends Error {
  readonly code: string;

  readonly httpStatus: number;

  constructor(args: { code: string; message: string; httpStatus: number }) {
    super(args.message);
    this.name = 'FileAttachmentUploadError';
    this.code = args.code;
    this.httpStatus = args.httpStatus;
  }
}

export interface HandoffDeps {
  gateway: HandoffGatewayOps;
  session: SessionOps;
  /** Test-only backend compatibility; production defaults never use this. */
  backend: BackendOps;
  attachmentUploader: FileAttachmentUploaderOps;
}
