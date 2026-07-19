type Processor = { processNext(): Promise<object | null> };

const abortableSleep = (milliseconds: number, signal: AbortSignal) => new Promise<void>((resolve) => {
  if (signal.aborted) {
    resolve();
    return;
  }
  const timer = setTimeout(done, milliseconds);
  function done() {
    clearTimeout(timer);
    signal.removeEventListener('abort', done);
    resolve();
  }
  signal.addEventListener('abort', done, { once: true });
});

export const runReportWorker = async (
  processor: Processor,
  options: {
    signal: AbortSignal;
    idleDelayMs: number;
    maintenanceIntervalMs?: number;
    maintain?: () => Promise<void>;
    now?: () => number;
    sleep?: (milliseconds: number, signal: AbortSignal) => Promise<void>;
    onIterationError?: () => void;
  },
) => {
  const sleep = options.sleep ?? abortableSleep;
  const now = options.now ?? Date.now;
  let nextMaintenanceAt = now() + (options.maintenanceIntervalMs ?? Number.POSITIVE_INFINITY);
  while (!options.signal.aborted) {
    try {
      if (options.maintain && now() >= nextMaintenanceAt) {
        await options.maintain();
        nextMaintenanceAt = now() + (options.maintenanceIntervalMs ?? Number.POSITIVE_INFINITY);
      }
      const result = await processor.processNext();
      if (result === null) await sleep(options.idleDelayMs, options.signal);
    } catch {
      options.onIterationError?.();
      await sleep(options.idleDelayMs, options.signal);
    }
  }
};
