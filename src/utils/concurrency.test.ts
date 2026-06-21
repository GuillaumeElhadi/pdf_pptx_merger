import { describe, it, expect } from "vitest";
import { mapWithConcurrency } from "./concurrency";

/** Creates a promise plus its external resolve/reject, for manual completion-order control. */
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (err: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe("mapWithConcurrency", () => {
  it("retourne [] pour une liste vide sans appeler worker", async () => {
    let called = false;
    const result = await mapWithConcurrency([], 2, async () => {
      called = true;
      return 0;
    });
    expect(result).toEqual([]);
    expect(called).toBe(false);
  });

  it("traite chaque item avec limit >= items.length (tous en parallèle)", async () => {
    const result = await mapWithConcurrency([1, 2, 3], 10, async (n) => n * 2);
    expect(result).toEqual([2, 4, 6]);
  });

  it("préserve l'ordre des résultats même si les workers terminent dans le désordre", async () => {
    const d1 = deferred<number>();
    const d2 = deferred<number>();
    const d3 = deferred<number>();
    const deferreds = [d1, d2, d3];

    const resultPromise = mapWithConcurrency([0, 1, 2], 3, (_item, i) => deferreds[i].promise);

    // Resolve out of order: item 2 first, then 0, then 1.
    d3.resolve(300);
    d1.resolve(100);
    d2.resolve(200);

    const result = await resultPromise;
    expect(result).toEqual([100, 200, 300]);
  });

  it("ne lance jamais plus de `limit` workers actifs simultanément", async () => {
    const items = [0, 1, 2, 3, 4];
    let active = 0;
    let maxActive = 0;
    const pending: Array<() => void> = [];

    const resultPromise = mapWithConcurrency(items, 2, (item) => {
      active++;
      maxActive = Math.max(maxActive, active);
      return new Promise<number>((resolve) => {
        pending.push(() => {
          active--;
          resolve(item);
        });
      });
    });

    // Let the microtask queue settle so all initially-launched workers have started.
    await Promise.resolve();
    await Promise.resolve();
    expect(maxActive).toBe(2); // only 2 of 5 should have started — limit respected

    // Drain workers one at a time, checking the cap holds throughout.
    while (pending.length > 0) {
      pending.shift()!();
      await Promise.resolve();
      await Promise.resolve();
      expect(maxActive).toBeLessThanOrEqual(2);
    }

    await resultPromise;
  });

  it("propage l'erreur d'un worker à l'appelant", async () => {
    await expect(
      mapWithConcurrency([1, 2], 2, async (n) => {
        if (n === 2) throw new Error("boom");
        return n;
      })
    ).rejects.toThrow("boom");
  });
});
