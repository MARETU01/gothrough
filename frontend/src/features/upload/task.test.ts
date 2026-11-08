import { describe, expect, it } from "vitest";
import { UploadTask } from './task';
import { createUploadSnapshot } from '@/utils/upload';
import type { UploadViewItem } from '@/types/upload';

const itemFor = () => {
  const task = new UploadTask(new File(['123456789012'], 'test'));
  task.beginAttempt();
  task.acceptSession({
    sessionId: 'test', totalChunks: 3, chunkSize: 5,
    receivedChunks: 0, finalFilename: 'test',
  });
  task.resumeTransfer();
  return task;
};
describe("upload byte progress", () => {
  it("does not count duplicate acknowledgements twice", () => {
    const item = itemFor();
    item.confirmChunk(0, 5);
    item.confirmChunk(0, 5);
    item.confirmChunk(2, 2);
    item.publishProgress();
    expect(item.loadedBytes).toBe(7);
    expect(item.confirmedChunks.size).toBe(2);
  });
  it("counts a short final chunk by its actual bytes even when it finishes first", () => {
    const item = itemFor();
    item.confirmChunk(2, 2);
    item.setInflight(0, 3);
    item.publishProgress();
    expect(item.loadedBytes).toBe(5);
    item.discardInflight(0);
    item.confirmChunk(0, 5);
    item.publishProgress();
    expect(item.loadedBytes).toBe(7);
  });
  it("does not regress while a failed chunk retries", () => {
    const item = itemFor();
    item.setInflight(0, 4);
    item.publishProgress();
    item.setInflight(0, 1);
    item.publishProgress();
    expect(item.loadedBytes).toBe(4);
  });
});

it('publishes complete lifecycle states and keeps uncertain completion on retry', () => {
  const snapshots: UploadViewItem[] = [];
  const task = new UploadTask(new File(['hello'], 'file.txt'), () => {
    snapshots.push(createUploadSnapshot(task));
  });
  task.beginAttempt();
  task.acceptSession({ sessionId: 'original', totalChunks: 1, chunkSize: 5,
    receivedChunks: 0, finalFilename: 'file.txt' });
  task.resumeTransfer();
  task.confirmChunk(0, 5);
  task.beginCompletion();
  task.fail('confirmation failed');
  expect(snapshots.at(-1)).toMatchObject({ state: 'error', error: 'confirmation failed', loadedBytes: 5 });
  expect(task.beginAttempt()).toBe(true);
  expect(task.session?.sessionId).toBe('original');
  task.beginCompletion();
  const before = snapshots.length;
  task.complete('saved.txt');
  expect(snapshots.slice(before)).toEqual([expect.objectContaining({
    state: 'success', savedFilename: 'saved.txt', loadedBytes: 5, speed: 0, error: '',
  })]);
  expect(task.completionPending).toBe(false);
});

it('resets a failed transfer before a fresh attempt without leaking its progress', () => {
  const task = itemFor();
  task.setInflight(0, 3);
  task.publishProgress();
  task.fail('network failure');
  expect(task.session).toBeNull();
  expect(task.loadedBytes).toBe(0);
  expect(task.beginAttempt()).toBe(false);
  expect(task.state).toBe('initializing');
  expect(task.confirmedChunks.size).toBe(0);
  expect(task.inflightBytes.size).toBe(0);
  expect(task.savedFilename).toBe('');
});
