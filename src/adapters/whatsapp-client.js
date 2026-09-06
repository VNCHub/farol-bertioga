// Adapter do WhatsApp Web (whatsapp-web.js): sobe/derruba o cliente, valida a
// sessão salva e expõe o mínimo que os serviços precisam. Não conhece
// destinatários nem a semântica de "alerta" — isso é `services/notifier.js`.

import { existsSync, rmSync } from 'node:fs';
import qrcode from 'qrcode-terminal';
import whatsapp from 'whatsapp-web.js';
import {
  WHATSAPP_AUTH_DIR as AUTH_DIR,
  WHATSAPP_CACHE_DIR as CACHE_DIR,
  WHATSAPP_CLIENT_ID as CLIENT_ID,
  WHATSAPP_HEADLESS,
  normalizeNumber,
  whatsAppSender,
} from '../config.js';
import { closeStrayPages, sanitizeBrowserProfile } from './browser-profile.js';

const { Client, LocalAuth } = whatsapp;

// whatsapp-web.js: ACK_ERROR=-1, ACK_PENDING=0, ACK_SERVER=1, ACK_DEVICE=2, ACK_READ=3.
const ACK_SERVER = 1;

// sendMessage() resolve quando a mensagem entra na fila da página do WhatsApp Web,
// não quando o servidor a recebe. Sem esperar o ACK, destruir o cliente logo depois
// mata a mensagem antes de ela sair.
export function waitForServerAck(client, sentMessage, timeoutMs) {
  // Em algumas versões do whatsapp-web.js, sendMessage() resolve com undefined
  // mesmo tendo enfileirado a mensagem. Sem o id não dá para casar o ACK;
  // espera qualquer message_ack de saída chegar ao servidor dentro do timeout.
  const targetId = sentMessage?.id?._serialized;
  if (sentMessage && (sentMessage.ack ?? 0) >= ACK_SERVER) return Promise.resolve(true);

  return new Promise((resolve) => {
    const finish = (delivered) => {
      client.off('message_ack', onAck);
      clearTimeout(timer);
      resolve(delivered);
    };
    const onAck = (message, ack) => {
      if (ack < ACK_SERVER) return;
      if (targetId) {
        if (message.id?._serialized === targetId) finish(true);
      } else if (message.fromMe) {
        finish(true);
      }
    };
    const timer = setTimeout(() => finish(false), timeoutMs);
    client.on('message_ack', onAck);
  });
}

export function createWhatsAppClient({ onStatus = console.log } = {}) {
  const expectedSender = normalizeNumber(whatsAppSender());

  // Cada execução começa com o navegador limpo; só a sessão do WhatsApp persiste.
  sanitizeBrowserProfile(onStatus);

  const client = new Client({
    authStrategy: new LocalAuth({ clientId: CLIENT_ID }),
    puppeteer: {
      headless: WHATSAPP_HEADLESS,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--hide-crash-restore-bubble',
        '--disable-session-crashed-bubble',
        '--no-first-run',
      ],
    },
  });

  const ready = new Promise((resolve, reject) => {
    client.on('qr', (qr) => {
      onStatus('Escaneie o QR Code em WhatsApp > Aparelhos conectados > Conectar aparelho.');
      qrcode.generate(qr, { small: true });
    });
    client.on('authenticated', () => onStatus('WhatsApp autenticado.'));
    client.on('auth_failure', (message) => reject(new Error(`Falha na autenticação do WhatsApp: ${message}`)));
    client.on('ready', () => {
      const connectedSender = normalizeNumber(client.info.wid.user);
      if (connectedSender !== expectedSender) {
        reject(new Error(`O número conectado (${connectedSender}) não corresponde a WHATSAPP_SENDER.`));
        return;
      }
      onStatus(`WhatsApp pronto: ${connectedSender}.`);
      resolve(client);
    });
  });

  return { client, ready };
}

// Sobe o cliente e espera ficar pronto (`ready`). Se não houver sessão salva,
// createWhatsAppClient imprime o QR Code no terminal. Retorna o client conectado;
// cabe ao chamador chamar `client.destroy()` (ou use `withWhatsApp`).
export async function connectWhatsApp({ onStatus = console.log } = {}) {
  const { client, ready } = createWhatsAppClient({ onStatus });
  try {
    await client.initialize();
    await ready;
    await closeStrayPages(client);
    return client;
  } catch (error) {
    await client.destroy().catch(() => {});
    throw error;
  }
}

// Conecta, roda `fn(client)` e **sempre** encerra o Chromium ao final.
// É o padrão de uso: uma janela sobe só durante a operação e fecha logo depois.
export async function withWhatsApp(fn, { onStatus = console.log } = {}) {
  const client = await connectWhatsApp({ onStatus });
  try {
    return await fn(client);
  } finally {
    await client.destroy().catch(() => {});
  }
}

// Há uma sessão do WhatsApp Web salva em disco?
export function whatsAppSessionExists() {
  return existsSync(AUTH_DIR);
}

// Remove os diretórios da sessão do WhatsApp Web em disco.
export function clearWhatsAppSessionFiles() {
  rmSync(AUTH_DIR, { recursive: true, force: true });
  rmSync(CACHE_DIR, { recursive: true, force: true });
}
