import { expect, it } from 'vitest';
import { collectDroppedFiles, getUploadPath } from './droppedFiles';
import { getFileKey } from './upload';

const fileEntry = (name: string): FileSystemEntry => ({
  name, isFile: true, isDirectory: false,
  file: (done: (file: File) => void) => done(new File(['hello'], name, { lastModified: 1 })),
} as unknown as FileSystemEntry);

const directory = (name: string, batches: FileSystemEntry[][]): FileSystemEntry => ({
  name, isFile: false, isDirectory: true,
  createReader: () => {
    let index = 0;
    return { readEntries: (done: (entries: FileSystemEntry[]) => void) => done(batches[index++] ?? []) };
  },
} as unknown as FileSystemEntry);

const transfer = (...entries: FileSystemEntry[]) => ({
  items: entries.map(entry => ({ kind: 'file', webkitGetAsEntry: () => entry, getAsFile: () => null })),
  files: [],
} as unknown as DataTransfer);

it('reads nested folders, every batch beyond 100 entries, and mixed loose files', async () => {
  const entries = Array.from({ length: 101 }, (_, i) => fileEntry(`${i}.txt`));
  const files = await collectDroppedFiles(transfer(
    directory('项目', [entries.slice(0, 100), entries.slice(100), [directory('子目录', [[fileEntry('100%.txt')]])]]),
    fileEntry('loose.txt'),
  ));
  expect(files).toHaveLength(103);
  expect(getUploadPath(files[100])).toBe('项目/100.txt');
  expect(getUploadPath(files[101])).toBe('项目/子目录/100%.txt');
  expect(getUploadPath(files[102])).toBe('loose.txt');
});

it('keeps identical files in different folders distinct', async () => {
  const files = await collectDroppedFiles(transfer(
    directory('a', [[fileEntry('same.txt')]]), directory('b', [[fileEntry('same.txt')]]),
  ));
  expect(getFileKey(files[0])).not.toBe(getFileKey(files[1]));
});

it('supports ordinary file fallback and empty folders', async () => {
  const file = new File(['hello'], 'file.txt');
  expect(await collectDroppedFiles({ files: [file] } as unknown as DataTransfer)).toEqual([file]);
  expect(await collectDroppedFiles({ items: [{ kind: 'file', getAsFile: () => file }], files: [file] } as unknown as DataTransfer)).toEqual([file]);
  expect(await collectDroppedFiles(transfer(directory('empty', [])))).toEqual([]);
});

it('reports unreadable folders instead of silently omitting their files', async () => {
  const entry = {
    name: 'denied', isDirectory: true, isFile: false,
    createReader: () => ({ readEntries: (_done: unknown, fail: (error: Error) => void) => fail(new Error('denied')) }),
  } as unknown as FileSystemEntry;
  await expect(collectDroppedFiles(transfer(entry))).rejects.toThrow('denied');
});
