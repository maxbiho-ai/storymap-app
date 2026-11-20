/**
 * Runs `worker` over `items` with at most `concurrency` in flight.
 * Never rejects: each item's error goes to the worker's own handling.
 */
export async function runQueue<T>(items: T[], concurrency: number, worker: (item: T, index: number) => Promise<void>): Promise<void> {
  let next = 0;
  const lanes = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      try {
        await worker(items[i], i);
      } catch (err) {
        console.error("queue item failed", err);
      }
    }
  });
  await Promise.all(lanes);
}
