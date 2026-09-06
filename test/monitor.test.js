import { afterEach, describe, expect, it, vi } from 'vitest';
import { checkAvailability, sleep } from '../src/monitor.js';

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

// page falso: cada item de `frameTexts` vira um frame cujo body.innerText()
// resolve com a string — ou rejeita, se for um Error.
function fakePage(frameTexts) {
  return {
    frames: () => frameTexts.map((value) => ({
      locator: () => ({
        innerText: () => (value instanceof Error ? Promise.reject(value) : Promise.resolve(value)),
      }),
    })),
  };
}

describe('checkAvailability', () => {
  it('retorna "unavailable" quando algum frame traz "Nenhum mês aberto"', async () => {
    const report = vi.fn();
    const page = fakePage(['bla bla', 'Nenhum mês aberto no momento']);

    expect(await checkAvailability(page, report)).toBe('unavailable');
    expect(report).toHaveBeenCalledWith('VAGA NÃO DISPONÍVEL');
  });

  it('reconhece a frase independentemente de caixa/acentuação do portal', async () => {
    const page = fakePage(['... NENHUM MÊS ABERTO ...']);
    expect(await checkAvailability(page, vi.fn())).toBe('unavailable');
  });

  it('retorna "unknown" (nunca afirma vaga por suposição) para qualquer outra resposta', async () => {
    const report = vi.fn();
    const page = fakePage(['Selecione o período da sua hospedagem']);

    expect(await checkAvailability(page, report)).toBe('unknown');
    expect(report).toHaveBeenCalledWith(
      'FALLBACK: RESPOSTA INESPERADA',
      expect.any(String),
    );
  });

  it('tolera frames cujo innerText() rejeita', async () => {
    const page = fakePage([new Error('frame detached'), 'Nenhum mês aberto']);
    expect(await checkAvailability(page, vi.fn())).toBe('unavailable');
  });

  it('retorna "unknown" quando todos os frames falham', async () => {
    const page = fakePage([new Error('a'), new Error('b')]);
    expect(await checkAvailability(page, vi.fn())).toBe('unknown');
  });
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
