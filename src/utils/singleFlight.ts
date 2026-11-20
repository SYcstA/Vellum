/**
 * Wrap an async job so overlapping calls never run it in parallel.
 * - Same key while a run is in flight: the caller shares that run.
 * - Different key: it runs after the current one finishes, with its own key
 *   (so a changed setting is never answered with a result decided on the old one).
 */
export function keyedSingleFlight<K>(run: (key: K) => Promise<void>): (key: K) => Promise<void> {
  let current: { key: K; promise: Promise<void> } | null = null;
  return (key: K) => {
    if (current && current.key === key) return current.promise;
    const previous = current ? current.promise.catch(() => {}) : Promise.resolve();
    const entry = { key, promise: previous.then(() => run(key)) };
    const clear = () => { if (current === entry) current = null; };
    entry.promise.then(clear, clear);
    current = entry;
    return entry.promise;
  };
}
