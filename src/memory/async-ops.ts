/**
 * async-ops.ts — Async memory operations with webhook support.
 *
 * Non-blocking memory extraction for long-running operations (large transcripts,
 * batch imports). Returns immediately with a job ID; results delivered via
 * webhook or polled via status endpoint.
 *
 * Pattern: submit → process (background) → complete → webhook callback
 */

/// <reference types="node" />
import { createHash } from 'node:crypto';
import { EventEmitter } from 'node:events';

// ─── Types ───────────────────────────────────────────────────────────────────

export type JobStatus = 'pending' | 'processing' | 'completed' | 'failed' | 'cancelled';

export type JobType = 'extract' | 'search' | 'bulk_import' | 'evolve' | 'dream';

export interface AsyncJob {
  id: string;
  type: JobType;
  status: JobStatus;
  input: unknown;
  output?: unknown;
  error?: string;
  createdAt: string;
  startedAt?: string;
  completedAt?: string;
  webhookUrl?: string;
  webhookStatus?: 'pending' | 'sent' | 'failed' | 'skipped';
  progress?: number; // 0..1
  metadata?: Record<string, unknown>;
}

export interface AsyncSubmitOptions {
  type: JobType;
  input: unknown;
  webhookUrl?: string;
  metadata?: Record<string, unknown>;
}

export interface AsyncProcessor {
  type: JobType;
  process(input: unknown, job: AsyncJob, onProgress?: (pct: number) => void): Promise<unknown>;
}

// ─── AsyncJobManager ─────────────────────────────────────────────────────────

export class AsyncJobManager extends EventEmitter {
  private jobs = new Map<string, AsyncJob>();
  private processors = new Map<JobType, AsyncProcessor>();
  private queue: string[] = [];
  private running = false;
  private maxConcurrent: number;
  private activeCount = 0;
  private jobTimeoutMs: number;
  private retentionMs: number;
  private lastCleanup = Date.now();

  constructor(opts?: {
    maxConcurrent?: number;
    jobTimeoutMs?: number;
    retentionMs?: number;
  }) {
    super();
    this.maxConcurrent = opts?.maxConcurrent ?? 3;
    this.jobTimeoutMs = opts?.jobTimeoutMs ?? 300_000; // 5 min
    this.retentionMs = opts?.retentionMs ?? 3_600_000; // 1 hour
  }

  /**
   * Register a processor for a job type.
   */
  registerProcessor(proc: AsyncProcessor): void {
    this.processors.set(proc.type, proc);
  }

  /**
   * Submit a new async job. Returns immediately with the job ID.
   */
  submit(opts: AsyncSubmitOptions): AsyncJob {
    const id = `job_${createHash('sha256').update(JSON.stringify(opts.input) + Date.now()).digest('hex').substring(0, 16)}`;
    const job: AsyncJob = {
      id,
      type: opts.type,
      status: 'pending',
      input: opts.input,
      webhookUrl: opts.webhookUrl,
      createdAt: new Date().toISOString(),
      metadata: opts.metadata,
    };
    this.jobs.set(id, job);
    this.queue.push(id);
    this.emit('job:submitted', job);
    void this.pump();
    return job;
  }

  /**
   * Get job status by ID.
   */
  getStatus(jobId: string): AsyncJob | null {
    return this.jobs.get(jobId) ?? null;
  }

  /**
   * Cancel a pending or processing job.
   */
  cancel(jobId: string): boolean {
    const job = this.jobs.get(jobId);
    if (!job) return false;
    if (job.status === 'completed' || job.status === 'failed') return false;
    job.status = 'cancelled';
    job.completedAt = new Date().toISOString();
    this.emit('job:cancelled', job);
    // Remove from queue
    this.queue = this.queue.filter((id) => id !== jobId);
    return true;
  }

  /**
   * List jobs, optionally filtered by status.
   */
  list(filter?: { status?: JobStatus; type?: JobType }): AsyncJob[] {
    const all = Array.from(this.jobs.values());
    return all.filter((j) => {
      if (filter?.status && j.status !== filter.status) return false;
      if (filter?.type && j.type !== filter.type) return false;
      return true;
    });
  }

  /**
   * Clean up old completed/failed jobs.
   */
  cleanup(): number {
    const now = Date.now();
    let removed = 0;
    for (const [id, job] of this.jobs) {
      if (job.status === 'completed' || job.status === 'failed' || job.status === 'cancelled') {
        const completedTime = job.completedAt ? new Date(job.completedAt).getTime() : 0;
        if (now - completedTime > this.retentionMs) {
          this.jobs.delete(id);
          removed++;
        }
      }
    }
    this.lastCleanup = now;
    return removed;
  }

  /**
   * Get stats about the job queue.
   */
  stats(): {
    total: number;
    pending: number;
    processing: number;
    completed: number;
    failed: number;
    cancelled: number;
  } {
    const all = Array.from(this.jobs.values());
    return {
      total: all.length,
      pending: all.filter((j) => j.status === 'pending').length,
      processing: all.filter((j) => j.status === 'processing').length,
      completed: all.filter((j) => j.status === 'completed').length,
      failed: all.filter((j) => j.status === 'failed').length,
      cancelled: all.filter((j) => j.status === 'cancelled').length,
    };
  }

  /**
   * Process the queue.
   */
  private async pump(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      while (this.queue.length > 0 && this.activeCount < this.maxConcurrent) {
        const jobId = this.queue.shift();
        if (!jobId) break;
        const job = this.jobs.get(jobId);
        if (!job || job.status === 'cancelled') continue;
        void this.runJob(job);
      }
    } finally {
      this.running = false;
    }
  }

  private async runJob(job: AsyncJob): Promise<void> {
    const proc = this.processors.get(job.type);
    if (!proc) {
      job.status = 'failed';
      job.error = `No processor registered for type: ${job.type}`;
      job.completedAt = new Date().toISOString();
      this.emit('job:failed', job);
      return;
    }

    this.activeCount++;
    job.status = 'processing';
    job.startedAt = new Date().toISOString();
    this.emit('job:started', job);

    const timeout = setTimeout(() => {
      if (job.status === 'processing') {
        job.status = 'failed';
        job.error = `Timeout after ${this.jobTimeoutMs}ms`;
        job.completedAt = new Date().toISOString();
        this.activeCount--;
        this.emit('job:failed', job);
        void this.fireWebhook(job);
      }
    }, this.jobTimeoutMs);

    try {
      const output = await proc.process(job.input, job, (pct: number) => {
        job.progress = Math.max(0, Math.min(1, pct));
        this.emit('job:progress', job);
      });

      clearTimeout(timeout);
      if ((job.status as JobStatus) === 'cancelled') return;

      job.status = 'completed';
      job.output = output;
      job.completedAt = new Date().toISOString();
      job.progress = 1;
      this.emit('job:completed', job);
      void this.fireWebhook(job);
    } catch (err) {
      clearTimeout(timeout);
      if ((job.status as JobStatus) === 'cancelled') return;

      job.status = 'failed';
      job.error = err instanceof Error ? err.message : String(err);
      job.completedAt = new Date().toISOString();
      this.emit('job:failed', job);
      void this.fireWebhook(job);
    } finally {
      this.activeCount--;
      void this.pump();
    }
  }

  private async fireWebhook(job: AsyncJob): Promise<void> {
    if (!job.webhookUrl) {
      job.webhookStatus = 'skipped';
      return;
    }

    const payload = JSON.stringify({
      event: `job:${job.status}`,
      job: {
        id: job.id,
        type: job.type,
        status: job.status,
        output: job.output,
        error: job.error,
        completedAt: job.completedAt,
      },
    });

    try {
      const resp = await fetch(job.webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: payload,
        signal: AbortSignal.timeout(10_000),
      });
      job.webhookStatus = resp.ok ? 'sent' : 'failed';
    } catch {
      job.webhookStatus = 'failed';
    }
  }
}

// ─── Singleton ───────────────────────────────────────────────────────────────

let singleton: AsyncJobManager | null = null;

export function getAsyncJobManager(): AsyncJobManager {
  if (!singleton) {
    singleton = new AsyncJobManager();
  }
  return singleton;
}

export function resetAsyncJobManager(): void {
  singleton = null;
}
