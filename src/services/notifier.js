// Serviço de notificação por WhatsApp: transforma um evento do monitor (ou um
// pedido de teste) numa mensagem entregue aos destinatários.
//
// - `sendWhatsAppAlert`: dado um client já conectado, envia o texto a todos os
//   destinatários e espera o ACK do servidor.
// - `sendTestMessage`: sobe o WhatsApp, manda a mensagem fixa de teste e fecha.
// - `createAlertDispatcher`: a função `onAlert` do `runMonitor`, com rate-limit.

import { report } from '../logger.js';
import {
  PORTAL_URL,
  normalizeMonthLabel,
  whatsAppAckTimeoutMs,
  whatsAppRecipients,
  whatsAppSettleMs,
} from '../config.js';
import { waitForServerAck, withWhatsApp } from '../adapters/whatsapp-client.js';

// No máximo um alerta a cada 10 minutos, somando vaga e fallback.
export const ALERT_COOLDOWN_MS = 10 * 60_000;

export const ALERT_MESSAGES = {
  available: (months = []) =>
    `Monitor Sesc Bertioga: VAGA aberta para ${months.length ? months.join(', ') : 'um ou mais meses'}! `
    + `Faça a inscrição agora no portal: ${PORTAL_URL}`,
  fallback: () =>
    'Monitor Sesc Bertioga: o portal respondeu de forma inesperada (possível mudança no site). '
    + `Confira manualmente: ${PORTAL_URL}`,
};

/** Monta o texto do alerta para um `kind` (cai em `fallback` para kind desconhecido). */
export function alertMessage(kind, months = []) {
  return (ALERT_MESSAGES[kind] ?? ALERT_MESSAGES.fallback)(months);
}

export const TEST_MESSAGE =
  'Teste do monitor Sesc Bertioga: o canal de alertas do WhatsApp está funcionando.';

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const waStatus = (message) => report('WHATSAPP', message);

/**
 * Envia `message` para todos os destinatários (`WHATSAPP_RECIPIENTS`) usando um
 * client já conectado. Aguarda o ACK do servidor de cada mensagem e, ao final,
 * pausa `WHATSAPP_SETTLE_MS` para o Chromium sincronizar antes de o chamador
 * encerrar o client. Retorna a lista de destinatários.
 */
export async function sendWhatsAppAlert(client, message, { onStatus = console.log } = {}) {
  const recipients = whatsAppRecipients();
  const ackTimeoutMs = whatsAppAckTimeoutMs();
  const settleMs = whatsAppSettleMs();
  const results = [];

  for (const recipient of recipients) {
    const sent = await client.sendMessage(`${recipient}@c.us`, message);
    const delivered = await waitForServerAck(client, sent, ackTimeoutMs);
    if (!delivered) {
      onStatus(`AVISO: ${recipient} sem confirmação do servidor em ${ackTimeoutMs}ms.`);
    }
    results.push(recipient);
  }

  if (settleMs > 0) await delay(settleMs);
  return results;
}

/** Sobe o WhatsApp, envia a mensagem de teste e fecha. Retorna os destinatários. */
export function sendTestMessage({ onStatus = waStatus } = {}) {
  return withWhatsApp((client) => sendWhatsAppAlert(client, TEST_MESSAGE, { onStatus }), { onStatus });
}

/**
 * Cria o despachante de alertas usado como `onAlert` do `runMonitor`.
 * Mantém rate-limit próprio: uma chamada bem-sucedida (ou tentada) inicia a janela
 * de silêncio; alertas nesse intervalo são só logados. `now`/`send` são injetáveis
 * para teste.
 *
 * @param {object}            [deps]
 * @param {number}            [deps.cooldownMs]
 * @param {string[]|Function} [deps.interestedMonths]  Rótulos ("Setembro / 2026") ou
 *        `() => string[]` — resolvido a cada alerta. Só alerta de vaga (`kind: 'available'`)
 *        cujo mês esteja na lista; lista vazia = qualquer mês. Não afeta `fallback`.
 * @param {Function}          [deps.now]       `() => number` (ms).
 * @param {Function}          [deps.onStatus]  log de status do WhatsApp.
 * @param {Function}          [deps.send]      `(message) => Promise<string[]>` — envio real.
 * @returns {(alert: { kind: 'available' | 'fallback', months?: string[], details?: string }) => Promise<object>}
 */
export function createAlertDispatcher({
  cooldownMs = ALERT_COOLDOWN_MS,
  interestedMonths = [],
  now = () => Date.now(),
  onStatus = waStatus,
  send = (message) => withWhatsApp((client) => sendWhatsAppAlert(client, message, { onStatus }), { onStatus }),
} = {}) {
  const resolveInterested = typeof interestedMonths === 'function'
    ? interestedMonths
    : () => interestedMonths;
  let lastAlertAt = -Infinity;

  return async function dispatch({ kind, months = [] }) {
    let alertMonths = months;

    // Filtro de meses de interesse — só para vaga com meses conhecidos.
    if (kind === 'available') {
      const wanted = (resolveInterested() ?? []).map(normalizeMonthLabel);
      if (wanted.length > 0 && months.length > 0) {
        alertMonths = months.filter((m) => wanted.includes(normalizeMonthLabel(m)));
        if (alertMonths.length === 0) {
          report('ALERTA', `available: ${months.join(', ')} fora dos meses de interesse — não enviado`);
          return { sent: false, reason: 'not-interested' };
        }
      }
    }

    const ts = now();
    const elapsed = ts - lastAlertAt;
    if (elapsed < cooldownMs) {
      const freeInMin = Math.ceil((cooldownMs - elapsed) / 60_000);
      report('ALERTA', `${kind}: suprimido pelo limite de ${cooldownMs / 60_000} min (libera em ~${freeInMin} min)`);
      return { sent: false, reason: 'cooldown' };
    }

    lastAlertAt = ts; // conta a tentativa mesmo se o envio falhar, para não insistir

    try {
      const recipients = await send(alertMessage(kind, alertMonths));
      const alvo = alertMonths.length ? ` (${alertMonths.join(', ')})` : '';
      report('ALERTA', `${kind}${alvo}: enviado — ${(recipients ?? []).join(', ')}`);
      return { sent: true, recipients };
    } catch (error) {
      report('ALERTA', `${kind}: FALLBACK — ${error.message}`);
      return { sent: false, reason: 'error', error };
    }
  };
}
