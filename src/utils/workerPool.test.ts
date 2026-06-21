import { describe, it, expect, vi } from "vitest";
import { createWorkerPool } from "./workerPool";

describe("createWorkerPool", () => {
  it("crée exactement `size` workers via factory, en différé (pas avant le premier acquire())", async () => {
    const factory = vi.fn().mockImplementation(async () => ({}));
    createWorkerPool(3, factory);
    expect(factory).not.toHaveBeenCalled();

    const pool = createWorkerPool(3, factory);
    await pool.acquire();
    expect(factory).toHaveBeenCalledTimes(3);
  });

  it("n'initialise les workers qu'une seule fois même avec des acquire() concurrents", async () => {
    let created = 0;
    const factory = vi.fn().mockImplementation(async () => ({ id: created++ }));
    const pool = createWorkerPool(2, factory);

    await Promise.all([pool.acquire(), pool.acquire()]);
    expect(factory).toHaveBeenCalledTimes(2);
  });

  it("acquire() rend des workers distincts tant que le pool n'est pas épuisé", async () => {
    const factory = vi.fn().mockImplementation(async () => ({}));
    const pool = createWorkerPool(2, factory);

    const w1 = await pool.acquire();
    const w2 = await pool.acquire();
    expect(w1).not.toBe(w2);
  });

  it("bloque acquire() au-delà de `size` jusqu'à un release()", async () => {
    const factory = vi.fn().mockImplementation(async () => ({}));
    const pool = createWorkerPool(1, factory);

    const w1 = await pool.acquire();
    let secondResolved = false;
    const secondAcquire = pool.acquire().then((w) => {
      secondResolved = true;
      return w;
    });

    await Promise.resolve();
    await Promise.resolve();
    expect(secondResolved).toBe(false); // still waiting — the only worker is held

    pool.release(w1);
    const w2 = await secondAcquire;
    expect(secondResolved).toBe(true);
    expect(w2).toBe(w1); // the released worker is the one handed to the waiter
  });

  it("release() réveille les attendants dans l'ordre FIFO", async () => {
    const factory = vi.fn().mockImplementation(async () => ({}));
    const pool = createWorkerPool(1, factory);
    const w1 = await pool.acquire();

    const order: string[] = [];
    const waiterA = pool.acquire().then((w) => {
      order.push("A");
      return w;
    });
    const waiterB = pool.acquire().then((w) => {
      order.push("B");
      return w;
    });

    pool.release(w1);
    const wA = await waiterA;
    pool.release(wA);
    await waiterB;

    expect(order).toEqual(["A", "B"]);
  });

  it("ne lance jamais plus de `size` workers actifs simultanément sous forte contention", async () => {
    const factory = vi.fn().mockImplementation(async () => ({}));
    const pool = createWorkerPool(2, factory);

    let active = 0;
    let maxActive = 0;
    let settled = 0;
    const release: Array<() => void> = [];
    const TOTAL_TASKS = 5;

    async function task() {
      const w = await pool.acquire();
      active++;
      maxActive = Math.max(maxActive, active);
      await new Promise<void>((resolve) => release.push(resolve));
      active--;
      settled++;
      pool.release(w);
    }

    const tasks = [task(), task(), task(), task(), task()];

    // Poll until every task has settled, draining whatever is waiting each tick.
    // Bounded to avoid a real hang turning into a silent infinite loop.
    for (let tick = 0; tick < 200 && settled < TOTAL_TASKS; tick++) {
      await Promise.resolve();
      const toRelease = release.splice(0, release.length);
      toRelease.forEach((r) => r());
    }

    await Promise.all(tasks);
    expect(settled).toBe(TOTAL_TASKS);
    expect(maxActive).toBe(2);
  });

  it("propage l'échec d'initialisation à tous les acquire() en attente", async () => {
    const factory = vi.fn().mockRejectedValue(new Error("init failed"));
    const pool = createWorkerPool(2, factory);

    await expect(pool.acquire()).rejects.toThrow("init failed");
    await expect(pool.acquire()).rejects.toThrow("init failed");
    expect(factory).toHaveBeenCalledTimes(2); // not retried on the second acquire()
  });

  it("drainIdle() retire et retourne tous les workers inactifs", async () => {
    const factory = vi.fn().mockImplementation(async () => ({}));
    const pool = createWorkerPool(2, factory);

    const w1 = await pool.acquire();
    const w2 = await pool.acquire();
    pool.release(w1);
    pool.release(w2);

    const drained = pool.drainIdle();
    expect(drained).toHaveLength(2);
    expect(drained).toEqual(expect.arrayContaining([w1, w2]));
  });

  it("drainIdle() n'inclut pas les workers actuellement acquis", async () => {
    const factory = vi.fn().mockImplementation(async () => ({}));
    const pool = createWorkerPool(2, factory);

    const w1 = await pool.acquire();
    const w2 = await pool.acquire();
    pool.release(w1); // w1 idle, w2 toujours acquis
    void w2; // held in pool, not released

    const drained = pool.drainIdle();
    expect(drained).toEqual([w1]);
  });

  it("drainIdle() vide le pool interne — un appel suivant ne retourne rien tant qu'aucun nouveau release()", async () => {
    const factory = vi.fn().mockImplementation(async () => ({}));
    const pool = createWorkerPool(1, factory);

    const w1 = await pool.acquire();
    pool.release(w1);
    pool.drainIdle();

    expect(pool.drainIdle()).toEqual([]);
  });
});
