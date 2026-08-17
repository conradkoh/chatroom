// fallow-ignore-file unused-export
import type { FileTreeCompressedPayload } from './shared';

export type BlobSnapshotPayload = {
  data: FileTreeCompressedPayload;
  dataHash: string;
  scannedAt: number;
};
export type BlobSnapshotReadResult = { data: FileTreeCompressedPayload; scannedAt: number };
export function toLegacyBlobSyncArgs(payload: BlobSnapshotPayload) {
  return { data: payload.data, dataHash: payload.dataHash, scannedAt: payload.scannedAt };
}
export function fromLegacyBlobReadResult(raw: BlobSnapshotReadResult | null) {
  return raw;
}
