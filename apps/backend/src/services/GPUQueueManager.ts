/**
 * GPUQueueManager
 * ~~~~~~~~~~~~~~~~
 * Singleton que asegura que solo UN job use la GPU a la vez.
 * Cuando llega un job aprobado:
 *   - Si la GPU está libre → empieza inmediatamente (GENERATING_ASSETS)
 *   - Si la GPU está ocupada → se encola (QUEUED)
 * Cuando un job termina (COMPLETED o FAILED) → el siguiente en cola arranca sólo.
 *
 * Integración: JobManager llama a GPUQueueManager.enqueue(jobId, runner)
 * donde runner es la función async que ejecuta el pipeline.
 */

import { EventEmitter } from 'events';

interface QueueEntry {
  jobId: string;
  runner: () => Promise<void>;
  enqueuedAt: Date;
}

class GPUQueueManager extends EventEmitter {
  private static instance: GPUQueueManager;

  private activeJobId: string | null = null;
  private queue: QueueEntry[] = [];

  private constructor() {
    super();
  }

  public static getInstance(): GPUQueueManager {
    if (!GPUQueueManager.instance) {
      GPUQueueManager.instance = new GPUQueueManager();
    }
    return GPUQueueManager.instance;
  }

  // ─── Public API ────────────────────────────────────────────────────────────

  /**
   * Intenta ejecutar el job inmediatamente si la GPU está libre.
   * Si está ocupada, encola y retorna false (el job queda en QUEUED).
   * Returns true si el job arrancó inmediatamente, false si quedó en cola.
   */
  public enqueue(jobId: string, runner: () => Promise<void>): boolean {
    if (this.activeJobId === null) {
      // GPU libre — arrancar inmediatamente
      this._run({ jobId, runner, enqueuedAt: new Date() });
      return true;
    } else {
      // GPU ocupada — encolar
      this.queue.push({ jobId, runner, enqueuedAt: new Date() });
      console.log(`[GPUQueue] ⏳ Job ${jobId} encolado (posición ${this.queue.length}). GPU ocupada por: ${this.activeJobId}`);
      return false;
    }
  }

  /**
   * Cancela un job de la cola (solo si todavía está encolado, no si ya está corriendo).
   * Returns true si fue cancelado, false si no estaba en la cola.
   */
  public cancel(jobId: string): boolean {
    const idx = this.queue.findIndex(e => e.jobId === jobId);
    if (idx === -1) return false;
    this.queue.splice(idx, 1);
    console.log(`[GPUQueue] 🗑 Job ${jobId} removido de la cola`);
    this.emit('cancelled', jobId);
    return true;
  }

  // ─── Status ────────────────────────────────────────────────────────────────

  public getStatus(): {
    activeJobId: string | null;
    queueLength: number;
    queue: Array<{ jobId: string; position: number; enqueuedAt: Date; waitingSeconds: number }>;
  } {
    const now = Date.now();
    return {
      activeJobId: this.activeJobId,
      queueLength: this.queue.length,
      queue: this.queue.map((e, i) => ({
        jobId: e.jobId,
        position: i + 1,
        enqueuedAt: e.enqueuedAt,
        waitingSeconds: Math.round((now - e.enqueuedAt.getTime()) / 1000),
      })),
    };
  }

  public isGPUFree(): boolean {
    return this.activeJobId === null;
  }

  public isJobActive(jobId: string): boolean {
    return this.activeJobId === jobId;
  }

  public getQueuePosition(jobId: string): number {
    const idx = this.queue.findIndex(e => e.jobId === jobId);
    return idx === -1 ? -1 : idx + 1;
  }

  // ─── Private ───────────────────────────────────────────────────────────────

  private _run(entry: QueueEntry): void {
    this.activeJobId = entry.jobId;
    console.log(`[GPUQueue] 🚀 Arrancando job ${entry.jobId}`);
    this.emit('started', entry.jobId);

    entry.runner().finally(() => {
      console.log(`[GPUQueue] ✅ Job ${entry.jobId} terminó. Cola restante: ${this.queue.length}`);
      this.activeJobId = null;
      this.emit('finished', entry.jobId);
      this._processNext();
    });
  }

  private _processNext(): void {
    if (this.queue.length === 0) {
      console.log('[GPUQueue] Cola vacía. GPU libre.');
      return;
    }
    const next = this.queue.shift()!;
    const waitSec = Math.round((Date.now() - next.enqueuedAt.getTime()) / 1000);
    console.log(`[GPUQueue] ⏩ Arrancando siguiente job: ${next.jobId} (esperó ${waitSec}s)`);
    this._run(next);
  }
}

export const gpuQueue = GPUQueueManager.getInstance();
