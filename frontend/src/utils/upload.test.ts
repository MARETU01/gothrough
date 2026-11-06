import { describe, expect, it } from "vitest";
import { confirmChunk, recalcLoadedBytes } from "./upload";
import type { UploadItem } from "@/types/upload";

const itemFor = (): UploadItem => ({
  file: new File(["123456789012"], "test"),
  state: "uploading",
  error: "",
  session: {
    sessionId: "test",
    totalChunks: 3,
    chunkSize: 5,
    receivedChunks: 0,
    finalFilename: "test",
  },
  speed: 0,
  savedFilename: "",
  uploadController: null,
  loadedBytes: 0,
  elapsedMs: null,
  inflightBytes: new Map(),
  confirmedChunks: new Set(),
  confirmedBytes: 0,
  transferredBytes: 0,
});
describe("upload byte progress", () => {
  it("does not count duplicate acknowledgements twice", () => {
    const item = itemFor();
    confirmChunk(item, 0, 5);
    confirmChunk(item, 0, 5);
    confirmChunk(item, 2, 2);
    recalcLoadedBytes(item);
    expect(item.loadedBytes).toBe(7);
    expect(item.confirmedChunks.size).toBe(2);
  });
  it("counts a short final chunk by its actual bytes even when it finishes first", () => {
    const item = itemFor();
    confirmChunk(item, 2, 2);
    item.inflightBytes.set(0, 3);
    recalcLoadedBytes(item);
    expect(item.loadedBytes).toBe(5);
    item.inflightBytes.delete(0);
    confirmChunk(item, 0, 5);
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
