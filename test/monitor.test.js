import { afterEach, describe, expect, it, vi } from 'vitest';
import { sleep } from '../src/services/monitor.js';

afterEach(() => {
  vi.useRealTimers();
});

describe('sleep', () => {
  it('resolve na hora se o signal já está abortado', async () => {
    const controller = new AbortController();
    controller.abort();

    // Sem fake timers: se criasse um timer de 1h, o teste estouraria.
    await expect(sleep(3_600_000, controller.signal)).resolves.toBeUndefined();
  });

  it('resolve assim que o signal é abortado durante a espera', async () => {
    vi.useFakeTimers();
    const controller = new AbortController();

    const pending = sleep(3_600_000, controller.signal);
    controller.abort();

    await expect(pending).resolves.toBeUndefined();
  });

  it('resolve ao fim do prazo quando não há signal', async () => {
    vi.useFakeTimers();
    const pending = sleep(1_000);
    vi.advanceTimersByTime(1_000);
    await expect(pending).resolves.toBeUndefined();
  });
});
