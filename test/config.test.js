import { afterEach, describe, expect, it, vi } from 'vitest';
import { normalizeNumber, numberFromEnv, whatsAppRecipients } from '../src/config.js';

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
