import { describe, expect, it } from "vitest";
import { recalcLoadedBytes } from "./upload";
import type { UploadItem } from "@/types/upload";

const itemFor = (): UploadItem => ({
  file: new File(["123456789012"], "test"),
  state: "uploading",
  error: "",
  session: {
    sessionId: "test",
    totalChunks: 3,
    chunkSize: 5,
    totalSize: 12,
    receivedChunks: 0,
    finalFilename: "test",
  },
  speed: 0,
  savedFilename: "",
  uploadController: null,
  loadedBytes: 0,
  inflightBytes: new Map(),
  confirmedBytes: new Map(),
  transferredBytes: 0,
});
describe("upload byte progress", () => {
  it("counts a short final chunk by its actual bytes even when it finishes first", () => {
    const item = itemFor();
    item.confirmedBytes.set(2, 2);
    item.inflightBytes.set(0, 3);
    recalcLoadedBytes(item);
    expect(item.loadedBytes).toBe(5);
    item.inflightBytes.delete(0);
    item.confirmedBytes.set(0, 5);
    recalcLoadedBytes(item);
    expect(item.loadedBytes).toBe(7);
  });
  it("does not regress while a failed chunk retries", () => {
    const item = itemFor();
    item.inflightBytes.set(0, 4);
    recalcLoadedBytes(item);
    item.inflightBytes.set(0, 1);
    recalcLoadedBytes(item);
    expect(item.loadedBytes).toBe(4);
  });
});
