import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { UploadQueueProvider } from '@/contexts/UploadQueueProvider';
import { initUpload, uploadChunk, completeUpload, cancelUpload } from '@/services/upload';
import UploadPage from './UploadPage';

vi.mock('@/services/upload', () => ({
  initUpload: vi.fn(), uploadChunk: vi.fn(), completeUpload: vi.fn(), cancelUpload: vi.fn(),
}));
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(initUpload).mockImplementation(async request => ({
    session_id: request.relative_path || request.filename,
    total_chunks: 1, chunk_size: 5, final_filename: request.relative_path || request.filename,
  }));
  vi.mocked(uploadChunk).mockResolvedValue({ received: 1 });
  vi.mocked(completeUpload).mockResolvedValue({ saved_filename: 'saved' });
  vi.mocked(cancelUpload).mockResolvedValue({ status: 'cancelled' });
});
afterEach(cleanup);

const fileEntry = () => ({
  name: 'same.txt', isFile: true, isDirectory: false,
  file: (done: (file: File) => void) => done(new File(['hello'], 'same.txt', { lastModified: 1 })),
});
const directory = (name: string) => ({
  name, isDirectory: true, isFile: false,
  createReader: () => {
    let read = false;
    return { readEntries: (done: (entries: unknown[]) => void) => {
      done(read ? [] : [fileEntry()]); read = true;
    } };
  },
});

it('drops folders into the real queue and uploads equal filenames with their separate relative paths', async () => {
  render(<MemoryRouter><UploadQueueProvider><UploadPage /></UploadQueueProvider></MemoryRouter>);
  const area = screen.getByRole('button', { name: '选择要上传的文件，支持多选' }).parentElement!;
  fireEvent.drop(area, { dataTransfer: {
    items: ['a', 'b'].map(name => ({ kind: 'file', webkitGetAsEntry: () => directory(name), getAsFile: () => null })),
    files: [],
  } });
  await screen.findByText('a/same.txt');
  await screen.findByText('b/same.txt');
  fireEvent.click(screen.getByRole('button', { name: '开始上传' }));
  await waitFor(() => expect(completeUpload).toHaveBeenCalledTimes(2));
  expect(vi.mocked(initUpload).mock.calls.map(([request]) => request)).toEqual([
    { filename: 'same.txt', relative_path: 'a/same.txt', total_size: 5 },
    { filename: 'same.txt', relative_path: 'b/same.txt', total_size: 5 },
  ]);
  expect(screen.getAllByText('上传成功')).toHaveLength(2);
});
