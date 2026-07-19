import { describe, expect, it, vi } from 'vitest';

import { runReportWorker } from '../src/report-worker.js';

describe('report worker loop', () => {
  it('processes jobs serially and waits only when the queue is empty', async () => {
    const controller = new AbortController();
    const processNext = vi.fn()
      .mockResolvedValueOnce({ id: 1 })
      .mockResolvedValueOnce(null);
    const sleep = vi.fn(async () => { controller.abort(); });

    await runReportWorker({ processNext }, {
      signal: controller.signal,
      idleDelayMs: 1_000,
      sleep,
      onIterationError: vi.fn(),
    });

    expect(processNext).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledTimes(1);
  });

  it('contains iteration errors, waits, and continues polling', async () => {
    const controller = new AbortController();
    const processNext = vi.fn()
      .mockRejectedValueOnce(new Error('temporary database failure'))
      .mockResolvedValueOnce(null);
    const onIterationError = vi.fn();
    const sleep = vi.fn(async () => {
      if (processNext.mock.calls.length === 2) controller.abort();
    });

    await runReportWorker({ processNext }, {
      signal: controller.signal,
      idleDelayMs: 500,
      sleep,
      onIterationError,
    });

    expect(processNext).toHaveBeenCalledTimes(2);
    expect(onIterationError).toHaveBeenCalledTimes(1);
    expect(sleep).toHaveBeenCalledTimes(2);
  });

  it('keeps sweeping stale jobs after a restart that happened before the stale threshold', async () => {
    const controller = new AbortController();
    let currentTime = 0;
    const maintain = vi.fn(async () => {
      if (maintain.mock.calls.length === 3) controller.abort();
    });
    const sleep = vi.fn(async () => {
      currentTime += 60_000;
    });

    await runReportWorker({ processNext: async () => null }, {
      signal: controller.signal,
      idleDelayMs: 60_000,
      maintenanceIntervalMs: 5 * 60_000,
      maintain,
      now: () => currentTime,
      sleep,
    });

    expect(maintain).toHaveBeenCalledTimes(3);
  });
});
