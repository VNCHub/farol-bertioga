import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ALERT_COOLDOWN_MS,
  ALERT_MESSAGES,
  createAlertDispatcher,
} from '../src/alerts.js';

// createAlertDispatcher usa report() (logger) internamente, que escreve no stdout.
beforeEach(() => {
  vi.spyOn(console, 'log').mockImplementation(() => {});
});

function setup(overrides = {}) {
  let clock = 1_000_000;
  const send = vi.fn().mockResolvedValue(['5511999990000']);
  const dispatch = createAlertDispatcher({
    now: () => clock,
    send,
    ...overrides,
  });
  return {
    dispatch,
    send,
    advance: (ms) => { clock += ms; },
  };
}

describe('createAlertDispatcher', () => {
  it('envia o primeiro alerta com a mensagem do kind e retorna os destinatários', async () => {
    const { dispatch, send } = setup();

    const result = await dispatch({ kind: 'available' });

    expect(send).toHaveBeenCalledOnce();
    expect(send).toHaveBeenCalledWith(ALERT_MESSAGES.available);
    expect(result).toEqual({ sent: true, recipients: ['5511999990000'] });
  });

  it('usa a mensagem de fallback para kind "fallback"', async () => {
    const { dispatch, send } = setup();

    await dispatch({ kind: 'fallback' });

    expect(send).toHaveBeenCalledWith(ALERT_MESSAGES.fallback);
  });

  it('cai na mensagem de fallback para kind desconhecido', async () => {
    const { dispatch, send } = setup();

    await dispatch({ kind: 'qualquer-coisa' });

    expect(send).toHaveBeenCalledWith(ALERT_MESSAGES.fallback);
  });

  it('suprime um segundo alerta dentro da janela de silêncio', async () => {
    const { dispatch, send, advance } = setup();

    await dispatch({ kind: 'available' });
    advance(ALERT_COOLDOWN_MS - 1);
    const result = await dispatch({ kind: 'fallback' });

    expect(result).toEqual({ sent: false, reason: 'cooldown' });
    expect(send).toHaveBeenCalledOnce();
  });

  it('libera o envio assim que o cooldown se esgota', async () => {
    const { dispatch, send, advance } = setup();

    await dispatch({ kind: 'available' });
    advance(ALERT_COOLDOWN_MS);
    const result = await dispatch({ kind: 'available' });

    expect(result.sent).toBe(true);
    expect(send).toHaveBeenCalledTimes(2);
  });

  it('respeita um cooldownMs customizado', async () => {
    const { dispatch, send, advance } = setup({ cooldownMs: 1_000 });

    await dispatch({ kind: 'available' });
    advance(999);
    expect((await dispatch({ kind: 'available' })).sent).toBe(false);
    advance(1);
    expect((await dispatch({ kind: 'available' })).sent).toBe(true);
    expect(send).toHaveBeenCalledTimes(2);
  });

  it('quando o envio falha, inicia a janela de silêncio mesmo assim (não insiste)', async () => {
    const boom = new Error('WhatsApp offline');
    const send = vi.fn().mockRejectedValue(boom);
    const { dispatch, advance } = setup({ send });

    const first = await dispatch({ kind: 'available' });
    expect(first).toEqual({ sent: false, reason: 'error', error: boom });

    // Chamada imediata seguinte: ainda dentro do cooldown, não tenta enviar de novo.
    advance(1);
    const second = await dispatch({ kind: 'available' });
    expect(second).toEqual({ sent: false, reason: 'cooldown' });
    expect(send).toHaveBeenCalledOnce();
  });

  it('normaliza recipients ausentes para lista vazia no log de sucesso', async () => {
    const send = vi.fn().mockResolvedValue(undefined);
    const { dispatch } = setup({ send });

    const result = await dispatch({ kind: 'available' });

    expect(result).toEqual({ sent: true, recipients: undefined });
  });
});
