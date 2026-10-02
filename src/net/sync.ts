/**
 * The guest's side of staying in step with the host: every host event has a
 * sequence number, and a full state resets the count. A gap, a duplicate, or
 * an event that couldn't be applied means asking for the full state again.
 */

export type SyncStatus = 'unsynced' | 'awaiting' | 'synced';

/** How long to wait for a requested state before asking again (seconds). */
const RETRY_AFTER_S = 3;

export class SyncTracker {
  status: SyncStatus = 'unsynced';
  epoch: string | null = null;
  lastSeq = -1;
  private requestedAt = -Infinity;

  /** A full state arrived: everything up to `seq` is now applied. */
  onState(epoch: string, seq: number): void {
    this.status = 'synced';
    this.epoch = epoch;
    this.lastSeq = seq;
  }

  /** An event arrived. Apply it, drop it (old or not in step yet), or note a gap. */
  onEvent(seq: number): 'apply' | 'drop' | 'gap' {
    if (this.status !== 'synced' || seq <= this.lastSeq) return 'drop';
    if (seq !== this.lastSeq + 1) {
      this.status = 'unsynced';
      return 'gap';
    }
    this.lastSeq = seq;
    return 'apply';
  }

  /** Something went wrong (an event failed, the connection dropped, the mat was moved). */
  markUnsynced(): void {
    this.status = 'unsynced';
  }

  /** Whether to ask the host for the full state now. */
  shouldRequest(now: number): boolean {
    if (this.status === 'unsynced') return true;
    return this.status === 'awaiting' && now - this.requestedAt > RETRY_AFTER_S;
  }

  requested(now: number): void {
    this.status = 'awaiting';
    this.requestedAt = now;
  }

  reset(): void {
    this.status = 'unsynced';
    this.epoch = null;
    this.lastSeq = -1;
    this.requestedAt = -Infinity;
  }
}
