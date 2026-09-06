import { EventEmitter } from 'node:events';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { waitForServerAck } from '../src/adapters/whatsapp-client.js';

afterEach(() => {
  vi.useRealTimers();
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
