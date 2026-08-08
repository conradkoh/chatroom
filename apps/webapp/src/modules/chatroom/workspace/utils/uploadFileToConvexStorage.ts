export type ConvexStorageUploadResult = { storageId: string };

const UPLOAD_FAILED_MESSAGE = 'Failed to upload file';

// fallow-ignore-file complexity
export async function uploadFileToConvexStorage(
  uploadUrl: string,
  file: File,
  onProgress?: (loaded: number, total: number) => void
): Promise<ConvexStorageUploadResult> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', uploadUrl);
    xhr.setRequestHeader('Content-Type', file.type || 'application/octet-stream');
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) {
        onProgress?.(event.loaded, event.total);
      }
    };
    xhr.onload = () => {
      if (xhr.status < 200 || xhr.status >= 300) {
        reject(new Error(UPLOAD_FAILED_MESSAGE));
        return;
      }
      try {
        const parsed = JSON.parse(xhr.responseText) as { storageId?: string };
        if (!parsed.storageId) {
          reject(new Error(UPLOAD_FAILED_MESSAGE));
          return;
        }
        resolve({ storageId: parsed.storageId });
      } catch {
        reject(new Error(UPLOAD_FAILED_MESSAGE));
      }
    };
    xhr.onerror = () => reject(new Error(UPLOAD_FAILED_MESSAGE));
    xhr.send(file);
  });
}
