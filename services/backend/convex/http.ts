import { FILE_ATTACHMENT_UPLOAD_PATH } from '@workspace/shared/domain/file-attachment';
import { httpRouter } from 'convex/server';

import { uploadFileAttachmentHttp } from './fileAttachments';

const http = httpRouter();

// File attachment uploads — the only writer of `_storage` blobs for handoffs.
http.route({
  path: FILE_ATTACHMENT_UPLOAD_PATH,
  method: 'POST',
  handler: uploadFileAttachmentHttp,
});

// HTTP routes can be added here as needed.
// Telegram integration is output-only — no inbound webhook routes required.

export default http;
