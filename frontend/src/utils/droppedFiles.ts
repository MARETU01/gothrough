const relativePaths = new WeakMap<File, string>();

export const getUploadPath = (file: File) =>
  relativePaths.get(file) || file.webkitRelativePath || file.name;

/** Capture entries before the browser clears the drag data after drop. */
export async function collectDroppedFiles(data: DataTransfer): Promise<File[]> {
  const sources = Array.from(data.items ?? [])
    .filter(item => item.kind === 'file')
    .map(item => ({ entry: item.webkitGetAsEntry?.(), file: item.getAsFile() }));
  const fallback = Array.from(data.files);
  const files: File[] = [];
  const visit = async (entry: FileSystemEntry, parent = ''): Promise<void> => {
    const path = parent + entry.name;
    if (entry.isFile) {
      const file = await new Promise<File>((resolve, reject) =>
        (entry as FileSystemFileEntry).file(resolve, reject));
      relativePaths.set(file, path);
      files.push(file);
    } else if (entry.isDirectory) {
      const reader = (entry as FileSystemDirectoryEntry).createReader();
      // Read every batch, including directories with more than 100 entries.
      while (true) {
        const batch = await new Promise<FileSystemEntry[]>((resolve, reject) =>
          reader.readEntries(resolve, reject));
        if (!batch.length) break;
        for (const child of batch) await visit(child, path + '/');
      }
    }
  };
  if (!sources.length) return fallback;
  for (const { entry, file } of sources) {
    if (entry) await visit(entry);
    else if (file) files.push(file);
  }
  return files;
}
