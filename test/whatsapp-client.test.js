import { EventEmitter } from 'node:events';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  normalizeNumber,
  numberFromEnv,
  recipientsFromEnv,
  waitForServerAck,
} from '../src/whatsapp-client.js';

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
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

describe('recipientsFromEnv', () => {
  it('parseia o array JSON e normaliza cada número', () => {
    vi.stubEnv('WHATSAPP_RECIPIENTS', '["+55 11 99999-0000","5511888887777"]');
    expect(recipientsFromEnv()).toEqual(['5511999990000', '5511888887777']);
  });

  it('rejeita quando a variável não existe (lista vazia)', () => {
    expect(() => recipientsFromEnv()).toThrow(/array JSON/);
  });

  it('rejeita quando não é um array', () => {
    vi.stubEnv('WHATSAPP_RECIPIENTS', '{"a":1}');
    expect(() => recipientsFromEnv()).toThrow(/array JSON/);
  });

  it('rejeita JSON inválido', () => {
    vi.stubEnv('WHATSAPP_RECIPIENTS', 'isto não é json');
    expect(() => recipientsFromEnv()).toThrow(/array JSON/);
  });

  it('propaga a falha de validação de um número inválido na lista', () => {
    vi.stubEnv('WHATSAPP_RECIPIENTS', '["123"]');
    expect(() => recipientsFromEnv()).toThrow(/array JSON/);
  });
});

describe('waitForServerAck', () => {
  it('resolve na hora quando a mensagem já tem ack >= SERVER', async () => {
    const client = new EventEmitter();
    await expect(waitForServerAck(client, { ack: 1 }, 1_000)).resolves.toBe(true);
  });

  it('resolve true quando chega um message_ack do servidor com o mesmo id', async () => {
    vi.useFakeTimers();
    const client = new EventEmitter();
    const sent = { id: { _serialized: 'MSG-1' }, ack: 0 };

    const pending = waitForServerAck(client, sent, 30_000);
    client.emit('message_ack', { id: { _serialized: 'OUTRA' } }, 1); // ignorada
    client.emit('message_ack', { id: { _serialized: 'MSG-1' } }, 1);

    await expect(pending).resolves.toBe(true);
  });

  it('ignora acks abaixo de SERVER', async () => {
    vi.useFakeTimers();
    const client = new EventEmitter();

    const pending = waitForServerAck(client, { id: { _serialized: 'X' }, ack: 0 }, 5_000);
    client.emit('message_ack', { id: { _serialized: 'X' } }, 0); // PENDING, não conta
    vi.advanceTimersByTime(5_000);

    await expect(pending).resolves.toBe(false);
  });

  it('sem id na mensagem enviada, aceita qualquer ack de saída (fromMe)', async () => {
    vi.useFakeTimers();
    const client = new EventEmitter();

    const pending = waitForServerAck(client, undefined, 30_000);
    client.emit('message_ack', { fromMe: true }, 2);

    await expect(pending).resolves.toBe(true);
  });

  it('resolve false ao estourar o timeout', async () => {
    vi.useFakeTimers();
    const client = new EventEmitter();

    const pending = waitForServerAck(client, { id: { _serialized: 'X' }, ack: 0 }, 10_000);
    vi.advanceTimersByTime(10_000);

    await expect(pending).resolves.toBe(false);
  });

  it('remove o listener de message_ack ao concluir', async () => {
    const client = new EventEmitter();
    const pending = waitForServerAck(client, { id: { _serialized: 'X' }, ack: 0 }, 30_000);
    client.emit('message_ack', { id: { _serialized: 'X' } }, 3);
    await pending;

    expect(client.listenerCount('message_ack')).toBe(0);
  });
});
