import { afterEach, describe, expect, it, vi } from 'vitest';
import { report, timestamp } from '../src/logger.js';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('timestamp', () => {
  it('devolve data e hora no formato ISO-like (sem fuso, separador T)', () => {
    expect(timestamp()).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/);
  });
});

describe('report', () => {
  it('imprime "<timestamp> STATUS" quando não há detalhes', () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});

    report('MONITORANDO');

    expect(log).toHaveBeenCalledOnce();
    expect(log.mock.calls[0][0]).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2} MONITORANDO$/);
  });

  it('anexa os detalhes com " — " quando fornecidos', () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});

    report('FALLBACK', 'resposta inesperada');

    expect(log.mock.calls[0][0]).toMatch(/ FALLBACK — resposta inesperada$/);
  });

  it('trata string de detalhes vazia como ausência de detalhes', () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});

    report('OK', '');

    expect(log.mock.calls[0][0]).not.toContain(' — ');
  });
});
