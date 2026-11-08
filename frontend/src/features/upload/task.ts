import type { UploadController, UploadItem, UploadSession } from '@/types/upload';
import type { Message } from '@/i18n/messages';

// The queue and engine read the same task, but all writes go through this owner.
// Lifecycle changes publish immediately; byte updates may wait for the engine's
// progress throttle. No React or translation runtime is needed here.
export class UploadTask implements UploadItem {
  private readonly data;
  private readonly changed: () => void;

  constructor(file: File, changed: () => void = () => {}) {
    this.changed = changed;
    this.data = {
      file, state: 'pending' as UploadItem['state'], error: '' as UploadItem['error'],
      session: null as Readonly<UploadSession> | null, completionPending: false,
      speed: 0, savedFilename: '', uploadController: null as UploadController | null,
      inflightBytes: new Map<number, number>(), confirmedChunks: new Set<number>(),
      confirmedBytes: 0, transferredBytes: 0, loadedBytes: 0, elapsedMs: null as number | null,
    };
  }

  get file() { return this.data.file; }
  get state() { return this.data.state; }
  get error() { return this.data.error; }
  get session() { return this.data.session; }
  get completionPending() { return this.data.completionPending; }
  get speed() { return this.data.speed; }
  get savedFilename() { return this.data.savedFilename; }
  get uploadController() { return this.data.uploadController; }
  get inflightBytes(): ReadonlyMap<number, number> { return this.data.inflightBytes; }
  get confirmedChunks(): ReadonlySet<number> { return this.data.confirmedChunks; }
  get confirmedBytes() { return this.data.confirmedBytes; }
  get transferredBytes() { return this.data.transferredBytes; }
  get loadedBytes() { return this.data.loadedBytes; }
  get elapsedMs() { return this.data.elapsedMs; }

  attachController(controller: UploadController) { this.data.uploadController = controller; }

  beginAttempt(): boolean {
    const confirming = this.completionPending && this.session !== null;
    if (!confirming) {
      this.resetProgress();
      this.data.session = null;
      this.data.savedFilename = '';
      this.data.completionPending = false;
    }
    this.data.state = confirming ? 'completing' : 'initializing';
    this.data.error = '';
    this.data.speed = 0;
    this.changed();
    return confirming;
  }

  // Retain even a late initialization receipt; cancellation still needs its ID.
  acceptSession(session: UploadSession) {
    this.data.session = { ...session };
    this.data.savedFilename = session.finalFilename;
    this.changed();
  }

  pauseTransfer() {
    this.data.state = 'paused';
    this.data.speed = 0;
    this.changed();
  }

  resumeTransfer() {
    this.data.state = 'uploading';
    this.changed();
  }

  beginCompletion() {
    if (!this.session) throw new Error('Cannot complete an upload without a session');
    this.data.state = 'completing';
    this.data.speed = 0;
    this.data.completionPending = true;
    this.changed();
  }

  complete(savedFilename?: string) {
    this.data.completionPending = false;
    this.data.state = 'success';
    this.data.speed = 0;
    this.data.savedFilename = savedFilename || this.savedFilename;
    this.data.inflightBytes.clear();
    this.data.loadedBytes = this.file.size;
    this.changed();
  }

  markCanceling() {
    this.data.state = 'canceling';
    this.data.speed = 0;
    this.changed();
  }

  // Cleanup is owned by the queue; uncertain publication keeps its receipt and
  // progress for another confirmation attempt, including after cancellation.
  fail(error: Message) { this.finishFailure('error', error); }
  interrupt() { this.finishFailure('pending', ''); }

  private finishFailure(state: 'error' | 'pending', error: Message) {
    if (!this.completionPending) {
      this.data.session = null;
      this.data.loadedBytes = 0;
    }
    this.data.inflightBytes.clear();
    this.data.state = state;
    this.data.error = error;
    this.data.speed = 0;
    this.changed();
  }

  endAttempt() {
    this.data.speed = 0;
    this.data.uploadController = null;
    this.changed();
  }

  // Sampling is batched by the queue, which publishes its React snapshot once.
  sampleElapsed(elapsedMs: number) { this.data.elapsedMs = elapsedMs; }
  sampleSpeed(speed: number) { this.data.speed = speed; }

  private resetProgress() {
    this.data.inflightBytes.clear();
    this.data.confirmedChunks.clear();
    this.data.confirmedBytes = 0;
    this.data.transferredBytes = 0;
    this.data.loadedBytes = 0;
  }

  recordTransferred(bytes: number) { this.data.transferredBytes += bytes; }
  setInflight(index: number, bytes: number) { this.data.inflightBytes.set(index, bytes); }
  discardInflight(index: number) { this.data.inflightBytes.delete(index); }

  confirmChunk(index: number, bytes: number) {
    if (this.data.confirmedChunks.has(index)) return;
    this.data.confirmedChunks.add(index);
    this.data.confirmedBytes += bytes;
    if (this.data.session) this.data.session = {
      ...this.data.session, receivedChunks: this.data.confirmedChunks.size,
    };
    this.data.inflightBytes.delete(index);
    this.publishProgress();
  }

  publishProgress() {
    this.recalcLoadedBytes();
    this.changed();
  }

  private recalcLoadedBytes() {
    if (this.state === 'success') { this.data.loadedBytes = this.file.size; return; }
    if (!this.session) { this.data.loadedBytes = 0; return; }
    let inflight = 0;
    this.data.inflightBytes.forEach(bytes => { inflight += bytes; });
    this.data.loadedBytes = Math.min(this.file.size,
      Math.max(this.loadedBytes, this.confirmedBytes + inflight));
  }
}
