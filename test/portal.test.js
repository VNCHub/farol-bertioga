import { describe, expect, it } from 'vitest';
import { classifyAvailability, parsePeriodCount } from '../src/adapters/portal.js';

// `checkAvailability` fala com o Playwright (clica pill a pill e lê o passo
// "Períodos") e não é coberto aqui — assim como `runMonitor`. O que dá para
// testar sem navegador é o núcleo puro: extrair a contagem de um texto e
// classificar a disponibilidade a partir dela.

describe('parsePeriodCount', () => {
  it('lê "Disponíveis (N)"', () => {
    expect(parsePeriodCount('1. Períodos  DISPONÍVEIS (0)  Ordenar por data')).toBe(0);
    expect(parsePeriodCount('Disponíveis (3)')).toBe(3);
  });

  it('trata as mensagens de "sem período" como 0', () => {
    expect(parsePeriodCount('Não há períodos disponíveis.')).toBe(0);
    expect(parsePeriodCount('Não existem períodos disponíveis.')).toBe(0);
  });

  it('retorna null quando não há contador reconhecível', () => {
    expect(parsePeriodCount('Selecione o período da sua hospedagem')).toBeNull();
    expect(parsePeriodCount('')).toBeNull();
  });
});

describe('classifyAvailability', () => {
  it('"Nenhum mês aberto" → unavailable (independe de caixa/acentuação)', () => {
    expect(classifyAvailability({ pageText: '... NENHUM MÊS ABERTO ...' })).toEqual({
      status: 'unavailable',
      availableMonths: [],
      listedMonths: [],
    });
  });

  it('mês com período > 0 → available, com o rótulo', () => {
    const result = classifyAvailability({
      pageText: 'Meses disponíveis',
      months: [{ label: 'Setembro / 2026', count: 2 }],
    });
    expect(result.status).toBe('available');
    expect(result.availableMonths).toEqual(['Setembro / 2026']);
  });

  it('mês listado com 0 períodos → sem-periodo (só log, sem alerta)', () => {
    const result = classifyAvailability({
      pageText: 'Meses disponíveis',
      months: [{ label: 'Setembro / 2026', count: 0 }],
    });
    expect(result.status).toBe('sem-periodo');
    expect(result.listedMonths).toEqual(['Setembro / 2026']);
    expect(result.availableMonths).toEqual([]);
  });

  it('contagem ilegível (null) → unknown (nunca afirma vaga por suposição)', () => {
    expect(classifyAvailability({
      pageText: 'Meses disponíveis',
      months: [{ label: 'Setembro / 2026', count: null }],
    }).status).toBe('unknown');
  });

  it('misto: um mês com vaga e outro sem → available + listedMonths preenchido', () => {
    const result = classifyAvailability({
      pageText: 'Meses disponíveis',
      months: [
        { label: 'Setembro / 2026', count: 0 },
        { label: 'Outubro / 2026', count: 1 },
      ],
    });
    expect(result.status).toBe('available');
    expect(result.availableMonths).toEqual(['Outubro / 2026']);
    expect(result.listedMonths).toEqual(['Setembro / 2026']);
  });

  it('sem meses e sem "Nenhum mês aberto" → unknown', () => {
    expect(classifyAvailability({ pageText: 'Selecione o período' }).status).toBe('unknown');
  });
});
