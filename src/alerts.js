import { report } from './logger.js';
import { sendWhatsAppAlert, withWhatsApp } from './whatsapp-client.js';

// No máximo um alerta a cada 10 minutos, somando vaga e fallback.
export const ALERT_COOLDOWN_MS = 10 * 60_000;

export const ALERT_MESSAGES = {
  available: 'Monitor Sesc Bertioga: VAGA possivelmente DISPONÍVEL — confira o portal de reservas agora.',
  fallback: 'Monitor Sesc Bertioga: o portal respondeu de forma inesperada (possível mudança no site ou vaga). Confira manualmente.',
};

/**
 * Cria o despachante de alertas usado como `onAlert` do `runMonitor`.
 * Mantém rate-limit próprio: uma chamada bem-sucedida (ou tentada) inicia a janela
 * de silêncio; alertas nesse intervalo são só logados. `now`/`send` são injetáveis
 * para teste.
 *
 * @param {object}   [deps]
 * @param {number}   [deps.cooldownMs]
 * @param {Function} [deps.now]       `() => number` (ms).
 * @param {Function} [deps.onStatus]  log de status do WhatsApp.
 * @param {Function} [deps.send]      `(message) => Promise<string[]>` — envio real.
 * @returns {(alert: { kind: 'available' | 'fallback', details?: string }) => Promise<object>}
 */
export function createAlertDispatcher({
  cooldownMs = ALERT_COOLDOWN_MS,
  now = () => Date.now(),
  onStatus = (message) => report('WHATSAPP', message),
  send = (message) => withWhatsApp((client) => sendWhatsAppAlert(client, message, { onStatus }), { onStatus }),
} = {}) {
  let lastAlertAt = -Infinity;

  return async function dispatch({ kind }) {
    const ts = now();
    const elapsed = ts - lastAlertAt;
    if (elapsed < cooldownMs) {
      const freeInMin = Math.ceil((cooldownMs - elapsed) / 60_000);
      report('ALERTA', `${kind}: suprimido pelo limite de ${cooldownMs / 60_000} min (libera em ~${freeInMin} min)`);
      return { sent: false, reason: 'cooldown' };
    }

    lastAlertAt = ts; // conta a tentativa mesmo se o envio falhar, para não insistir

    try {
      const recipients = await send(ALERT_MESSAGES[kind] ?? ALERT_MESSAGES.fallback);
      report('ALERTA', `${kind}: enviado — ${(recipients ?? []).join(', ')}`);
      return { sent: true, recipients };
    } catch (error) {
      report('ALERTA', `${kind}: FALLBACK — ${error.message}`);
      return { sent: false, reason: 'error', error };
    }
  };
}
