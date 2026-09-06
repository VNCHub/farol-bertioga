import { existsSync, readFileSync, readlinkSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import qrcode from 'qrcode-terminal';
import whatsapp from 'whatsapp-web.js';

const { Client, LocalAuth } = whatsapp;

const CLIENT_ID = 'sesc-bertioga-bot';
const AUTH_DIR = `.wwebjs_auth/session-${CLIENT_ID}`;
const CACHE_DIR = '.wwebjs_cache';
const PROFILE_DIR = join(AUTH_DIR, 'Default');

// Estado de restauração de abas/janelas do Chromium. Guardar isso entre execuções
// faz o navegador reabrir abas antigas (e acumular mais a cada vez). Os dados de
// login do WhatsApp NÃO ficam aqui — vivem em IndexedDB/Local Storage —, então
// apagar estes arquivos deixa a sessão intacta e cada execução começa limpa.
const TAB_STATE_ENTRIES = ['Sessions', 'Current Session', 'Current Tabs', 'Last Session', 'Last Tabs'];
const LOCK_ENTRIES = ['SingletonLock', 'SingletonCookie', 'SingletonSocket'];

// Se uma execução anterior morreu sem fechar o Chromium, ele fica órfão segurando
// o lock do perfil — e a próxima abertura falha ("browser is already running") ou
// vem em branco. Aqui matamos esse Chromium órfão (confirmando que é o nosso pelo
// cmdline) e removemos o lock.
function releaseProfileLock(onStatus) {
  const lockPath = join(AUTH_DIR, 'SingletonLock');
  let pid;
  try {
    pid = Number(readlinkSync(lockPath).split('-').pop());
  } catch {
    pid = undefined; // não é symlink ou não existe
  }

  if (Number.isInteger(pid) && pid > 0) {
    let cmdline = '';
    try {
      cmdline = readFileSync(`/proc/${pid}/cmdline`, 'utf8');
    } catch {
      cmdline = ''; // processo já não existe → lock órfão
    }
    if (cmdline.includes(`session-${CLIENT_ID}`)) {
      try {
        process.kill(pid, 'SIGKILL');
        onStatus?.(`Chromium órfão (pid ${pid}) encerrado.`);
      } catch {
        // sem permissão ou já morreu
      }
    }
  }

  for (const name of LOCK_ENTRIES) {
    rmSync(join(AUTH_DIR, name), { force: true });
  }
}

function sanitizeBrowserProfile(onStatus) {
  if (!existsSync(AUTH_DIR)) return;

  releaseProfileLock(onStatus);

  for (const entry of TAB_STATE_ENTRIES) {
    rmSync(join(PROFILE_DIR, entry), { recursive: true, force: true });
    rmSync(join(AUTH_DIR, entry), { recursive: true, force: true });
  }

  // Marca o perfil como encerrado corretamente — sem isso o Chromium acha que
  // travou e restaura as abas da sessão anterior. (São campos de estado, não
  // preferências protegidas: editar aqui não dispara aviso de adulteração.)
  const prefsPath = join(PROFILE_DIR, 'Preferences');
  try {
    const prefs = JSON.parse(readFileSync(prefsPath, 'utf8'));
    prefs.profile = { ...prefs.profile, exit_type: 'Normal', exited_cleanly: true };
    if (prefs.sessions) prefs.sessions.event_log = [];
    writeFileSync(prefsPath, JSON.stringify(prefs));
  } catch {
    // Primeira execução (sem Preferences ainda) — nada a fazer.
  }
}

// Fecha qualquer aba que não seja a do WhatsApp Web.
async function closeStrayPages(client) {
  const browser = client.pupBrowser;
  const keep = client.pupPage;
  if (!browser || !keep) return;
  const pages = await browser.pages().catch(() => []);
  await Promise.all(
    pages.filter((page) => page !== keep).map((page) => page.close().catch(() => {})),
  );
}

export function normalizeNumber(number) {
  const normalized = String(number).replace(/\D/g, '');
  if (normalized.length < 10 || normalized.length > 15) {
    throw new Error(`Número de WhatsApp inválido: ${number}`);
  }
  return normalized;
}

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// whatsapp-web.js: ACK_ERROR=-1, ACK_PENDING=0, ACK_SERVER=1, ACK_DEVICE=2, ACK_READ=3.
const ACK_SERVER = 1;

export function numberFromEnv(name, fallback) {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`${name} deve ser um número de milissegundos não-negativo.`);
  }
  return value;
}

// sendMessage() resolve quando a mensagem entra na fila da página do WhatsApp Web,
// não quando o servidor a recebe. Sem esperar o ACK, destruir o cliente logo depois
// (ex.: o finally do whatsapp-test.js) mata a mensagem antes de ela sair.
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

export function recipientsFromEnv() {
  try {
    const recipients = JSON.parse(process.env.WHATSAPP_RECIPIENTS ?? '[]');
    if (!Array.isArray(recipients) || recipients.length === 0) {
      throw new Error('a lista está vazia');
    }
    return recipients.map(normalizeNumber);
  } catch (error) {
    throw new Error(`WHATSAPP_RECIPIENTS deve ser um array JSON de números. ${error.message}`);
  }
}

export function createWhatsAppClient({ onStatus = console.log } = {}) {
  const expectedSender = normalizeNumber(process.env.WHATSAPP_SENDER ?? '');
  const headless = process.env.WHATSAPP_HEADLESS === 'true';

  // Cada execução começa com o navegador limpo; só a sessão do WhatsApp persiste.
  sanitizeBrowserProfile(onStatus);

  const client = new Client({
    authStrategy: new LocalAuth({ clientId: CLIENT_ID }),
    puppeteer: {
      headless,
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

export async function sendWhatsAppAlert(client, message, { onStatus = console.log } = {}) {
  const recipients = recipientsFromEnv();
  const ackTimeoutMs = numberFromEnv('WHATSAPP_ACK_TIMEOUT_MS', 30_000);
  const settleMs = numberFromEnv('WHATSAPP_SETTLE_MS', 3_000);
  const results = [];

  for (const recipient of recipients) {
    const chatId = `${recipient}@c.us`;
    const sent = await client.sendMessage(chatId, message);
    const delivered = await waitForServerAck(client, sent, ackTimeoutMs);
    if (!delivered) {
      onStatus(`AVISO: ${recipient} sem confirmação do servidor em ${ackTimeoutMs}ms.`);
    }
    results.push(recipient);
  }

  // Margem extra antes de o chamador encerrar o cliente, para o Chromium
  // terminar de sincronizar com o WhatsApp Web.
  if (settleMs > 0) await delay(settleMs);

  return results;
}

// Há uma sessão do WhatsApp Web salva em disco?
export function whatsAppSessionExists() {
  return existsSync(AUTH_DIR);
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

// Remove os diretórios da sessão do WhatsApp Web em disco.
export function clearWhatsAppSessionFiles() {
  rmSync(AUTH_DIR, { recursive: true, force: true });
  rmSync(CACHE_DIR, { recursive: true, force: true });
}

// Desvincula o aparelho (quando possível) e remove a sessão local.
export async function logoutWhatsApp({ onStatus = console.log } = {}) {
  if (!whatsAppSessionExists()) {
    onStatus('Nenhuma sessão de WhatsApp salva.');
    return;
  }

  let client;
  try {
    client = await connectWhatsApp({ onStatus });
    await client.logout(); // desvincula o aparelho também no celular
    onStatus('Aparelho desvinculado no WhatsApp.');
  } catch (error) {
    onStatus(`Não foi possível desvincular remotamente (${error.message}). Removendo só a sessão local.`);
  } finally {
    await client?.destroy().catch(() => {});
    clearWhatsAppSessionFiles();
    onStatus('Sessão local removida.');
  }
}
