import type { UploadItem, UploadViewItem } from "@/types/upload";
import { getUploadPath } from "./droppedFiles";

export const createUploadSnapshot = (
  item: UploadItem,
  previous?: UploadViewItem,
): UploadViewItem => {
  if (
    previous &&
    previous.file === item.file &&
    previous.state === item.state &&
    previous.speed === item.speed &&
    previous.savedFilename === item.savedFilename &&
    previous.loadedBytes === item.loadedBytes &&
    previous.error === item.error &&
    previous.elapsedMs === item.elapsedMs &&
    previous.session?.sessionId === item.session?.sessionId &&
    previous.session?.receivedChunks === item.session?.receivedChunks
  )
    return previous;
  return {
    file: item.file,
    state: item.state,
    speed: item.speed,
    savedFilename: item.savedFilename,
    loadedBytes: item.loadedBytes,
    error: item.error,
    elapsedMs: item.elapsedMs,
    session: item.session ? { ...item.session } : null,
  };
};

/** Include the path so equal filenames in different folders remain distinct. */
export const getFileKey = (file: File) =>
  `${getUploadPath(file)}-${file.size}-${file.lastModified}`;
