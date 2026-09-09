import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  canonicalMonthLabel,
  monthLabel,
  normalizeMonthLabel,
  normalizeNumber,
  numberFromEnv,
  upcomingMonthLabels,
  whatsAppRecipients,
} from '../src/config.js';

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('numberFromEnv', () => {
  it('usa o fallback quando a variável não existe', () => {
    expect(numberFromEnv('WHATSAPP_ACK_TIMEOUT_MS', 30_000)).toBe(30_000);
  });

  it('usa o fallback quando a variável está vazia', () => {
    vi.stubEnv('WHATSAPP_ACK_TIMEOUT_MS', '');
    expect(numberFromEnv('WHATSAPP_ACK_TIMEOUT_MS', 30_000)).toBe(30_000);
  });

  it('converte um valor numérico válido', () => {
    vi.stubEnv('WHATSAPP_SETTLE_MS', '4500');
    expect(numberFromEnv('WHATSAPP_SETTLE_MS', 3_000)).toBe(4_500);
  });

  it('aceita zero', () => {
    vi.stubEnv('WHATSAPP_SETTLE_MS', '0');
    expect(numberFromEnv('WHATSAPP_SETTLE_MS', 3_000)).toBe(0);
  });

  it('rejeita valores negativos', () => {
    vi.stubEnv('WHATSAPP_SETTLE_MS', '-1');
    expect(() => numberFromEnv('WHATSAPP_SETTLE_MS', 3_000)).toThrow(/não-negativo/);
  });

  it('rejeita valores não numéricos', () => {
    vi.stubEnv('WHATSAPP_SETTLE_MS', 'abc');
    expect(() => numberFromEnv('WHATSAPP_SETTLE_MS', 3_000)).toThrow(/não-negativo/);
  });
});

describe('normalizeNumber', () => {
  it('remove tudo que não for dígito', () => {
    expect(normalizeNumber('+55 (11) 99999-0000')).toBe('5511999990000');
  });

  it('aceita entrada numérica', () => {
    expect(normalizeNumber(1234567890)).toBe('1234567890');
  });

  it('rejeita menos de 10 dígitos', () => {
    expect(() => normalizeNumber('123456789')).toThrow(/inválido/);
  });

  it('rejeita mais de 15 dígitos', () => {
    expect(() => normalizeNumber('1234567890123456')).toThrow(/inválido/);
  });
});

describe('whatsAppRecipients', () => {
  it('parseia o array JSON e normaliza cada número', () => {
    vi.stubEnv('WHATSAPP_RECIPIENTS', '["+55 11 99999-0000","5511888887777"]');
    expect(whatsAppRecipients()).toEqual(['5511999990000', '5511888887777']);
  });

  it('rejeita quando a variável não existe (lista vazia)', () => {
    expect(() => whatsAppRecipients()).toThrow(/array JSON/);
  });

  it('rejeita quando não é um array', () => {
    vi.stubEnv('WHATSAPP_RECIPIENTS', '{"a":1}');
    expect(() => whatsAppRecipients()).toThrow(/array JSON/);
  });

  it('rejeita JSON inválido', () => {
    vi.stubEnv('WHATSAPP_RECIPIENTS', 'isto não é json');
    expect(() => whatsAppRecipients()).toThrow(/array JSON/);
  });

  it('propaga a falha de validação de um número inválido na lista', () => {
    vi.stubEnv('WHATSAPP_RECIPIENTS', '["123"]');
    expect(() => whatsAppRecipients()).toThrow(/array JSON/);
  });
});

describe('monthLabel', () => {
  it('formata como o portal ("Mês / AAAA"), índice base 0', () => {
    expect(monthLabel(2026, 8)).toBe('Setembro / 2026');
  });

  it('normaliza índice fora de 0–11', () => {
    expect(monthLabel(2027, 12)).toBe('Janeiro / 2027');
    expect(monthLabel(2026, -1)).toBe('Dezembro / 2026');
  });
});

describe('upcomingMonthLabels', () => {
  it('vai do mês atual até 3 à frente (4 rótulos)', () => {
    const now = new Date(2026, 8, 9); // 2026-09-09
    expect(upcomingMonthLabels(3, now)).toEqual([
      'Setembro / 2026',
      'Outubro / 2026',
      'Novembro / 2026',
      'Dezembro / 2026',
    ]);
  });

  it('cruza a virada de ano', () => {
    const now = new Date(2026, 10, 15); // Novembro/2026
    expect(upcomingMonthLabels(3, now)).toEqual([
      'Novembro / 2026',
      'Dezembro / 2026',
      'Janeiro / 2027',
      'Fevereiro / 2027',
    ]);
  });
});

describe('normalizeMonthLabel', () => {
  it('remove acento, caixa e espaços extras', () => {
    expect(normalizeMonthLabel('  MARÇO  /  2026 ')).toBe('marco / 2026');
  });

  it('deixa rótulos equivalentes iguais', () => {
    expect(normalizeMonthLabel('Setembro / 2026')).toBe(normalizeMonthLabel('SETEMBRO / 2026'));
  });
});

describe('canonicalMonthLabel', () => {
  it('normaliza a forma que o portal mostra', () => {
    expect(canonicalMonthLabel('SETEMBRO / 2026')).toBe('Setembro / 2026');
    expect(canonicalMonthLabel('setembro/2026')).toBe('Setembro / 2026');
    expect(canonicalMonthLabel('Março / 2027')).toBe('Março / 2027');
  });

  it('retorna null quando não casa com "<mês> / <ano>"', () => {
    expect(canonicalMonthLabel('Nenhum mês aberto')).toBeNull();
    expect(canonicalMonthLabel('Xxxxx / 2026')).toBeNull();
  });
});
