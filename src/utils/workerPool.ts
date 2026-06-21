export interface WorkerPool<T> {
  acquire(): Promise<T>;
  release(worker: T): void;
  drainIdle(): T[];
}

/**
 * Generic fixed-size resource pool. Workers are created lazily (on the first `acquire()`,
 * not at pool creation) via `factory`, called exactly `size` times total. Callers must
 * `release()` every worker they `acquire()`.
 */
export function createWorkerPool<T>(size: number, factory: () => Promise<T>): WorkerPool<T> {
  let idle: T[] = [];
  const waiters: Array<(worker: T) => void> = [];
  let initPromise: Promise<void> | null = null;

  function ensureInitialized(): Promise<void> {
    if (!initPromise) {
      initPromise = (async () => {
        const created = await Promise.all(Array.from({ length: size }, () => factory()));
        idle = created;
      })();
    }
    return initPromise;
  }

  return {
    async acquire(): Promise<T> {
      await ensureInitialized();
      const worker = idle.pop();
      if (worker !== undefined) return worker;
      return new Promise<T>((resolve) => waiters.push(resolve));
    },

    release(worker: T): void {
      const waiter = waiters.shift();
      if (waiter) {
        waiter(worker);
      } else {
        idle.push(worker);
      }
    },

    drainIdle(): T[] {
      const drained = idle;
      idle = [];
      return drained;
    },
  };
}
