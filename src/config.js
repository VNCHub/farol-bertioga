// Ponto único de configuração: toda leitura de `process.env` e todas as
// constantes ajustáveis do projeto vivem aqui. Os demais módulos importam daqui
// em vez de tocar em `process.env` diretamente — assim a validação falha no
// boot (ao importar este módulo), não no meio de um envio.
//
// Este módulo NÃO carrega o `.env` — cabe ao entrypoint fazer
// `import 'dotenv/config'` no topo, antes de qualquer import que puxe este aqui.

import { join } from 'node:path';

/**
 * Lê uma variável de ambiente como número de milissegundos não-negativo.
 * Retorna `fallback` quando a variável não existe ou está vazia.
 */
export function numberFromEnv(name, fallback) {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`${name} deve ser um número de milissegundos não-negativo.`);
  }
  return value;
}

// --- Portal de reservas ---------------------------------------------------

export const PORTAL_URL =
  process.env.PORTAL_URL?.trim() || 'https://centrodeferias.sescsp.org.br/reservas/';

// Intervalo entre consultas no loop interno e espera antes de reabrir o Chromium.
export const MONITOR_INTERVAL_MS = numberFromEnv('MONITOR_INTERVAL_MS', 60_000);
export const BROWSER_RESTART_MS = numberFromEnv('BROWSER_RESTART_MS', 5_000);

// Qualquer valor diferente de 'true' mantém o Chromium do portal visível (com slowMo).
export const PORTAL_HEADED = process.env.HEADLESS !== 'true';

/**
 * Credenciais do portal. Lança se `LOGIN`/`SENHA` não estiverem no `.env`
 * — chame no início de qualquer fluxo que vá abrir o portal.
 */
export function portalCredentials() {
  const login = process.env.LOGIN;
  const senha = process.env.SENHA;
  if (!login || !senha) {
    throw new Error('Defina LOGIN e SENHA no arquivo .env antes de executar.');
  }
  return { login, senha };
}

// --- Meses do portal ---------------------------------------------------
// O portal rotula os meses abertos como "Setembro / 2026". A CLI oferece os
// meses de interesse (do atual até +3) e o adapter compara o que achou no
// portal com essa lista — sempre pelo rótulo normalizado.

export const PORTAL_MONTHS = [
  'Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho',
  'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro',
];

/** Rótulo "Mês / AAAA" como o portal exibe. `monthIndex` base 0 (0 = Janeiro). */
export function monthLabel(year, monthIndex) {
  return `${PORTAL_MONTHS[((monthIndex % 12) + 12) % 12]} / ${year}`;
}

/** Rótulos do mês atual até `ahead` meses à frente, inclusive (padrão: 4 rótulos). */
export function upcomingMonthLabels(ahead = 3, now = new Date()) {
  return Array.from({ length: ahead + 1 }, (_, i) => {
    const d = new Date(now.getFullYear(), now.getMonth() + i, 1);
    return monthLabel(d.getFullYear(), d.getMonth());
  });
}

/** Normaliza um rótulo de mês para comparação: sem acento, minúsculo, espaços colapsados. */
export function normalizeMonthLabel(label) {
  return String(label)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * "SETEMBRO / 2026" | "setembro/2026" → "Setembro / 2026" (forma canônica do portal).
 * Retorna `null` quando o texto não casa com "<mês> / <ano>".
 */
export function canonicalMonthLabel(raw) {
  const match = String(raw).match(/([A-Za-zÀ-ÿ]+)\s*\/\s*(\d{4})/);
  if (!match) return null;
  const wanted = normalizeMonthLabel(match[1]);
  const index = PORTAL_MONTHS.findIndex((name) => normalizeMonthLabel(name) === wanted);
  return index < 0 ? null : monthLabel(match[2], index);
}

// --- WhatsApp -----------------------------------------------------------

export const WHATSAPP_CLIENT_ID = 'sesc-bertioga-bot';
export const WHATSAPP_AUTH_DIR = `.wwebjs_auth/session-${WHATSAPP_CLIENT_ID}`;
export const WHATSAPP_CACHE_DIR = '.wwebjs_cache';
export const WHATSAPP_PROFILE_DIR = join(WHATSAPP_AUTH_DIR, 'Default');

// 'true' roda o WhatsApp Web oculto (QR Code em ASCII no terminal).
export const WHATSAPP_HEADLESS = process.env.WHATSAPP_HEADLESS === 'true';

// Lidas a cada envio (não no boot) para o teste conseguir sobrescrevê-las.
export const whatsAppAckTimeoutMs = () => numberFromEnv('WHATSAPP_ACK_TIMEOUT_MS', 30_000);
export const whatsAppSettleMs = () => numberFromEnv('WHATSAPP_SETTLE_MS', 3_000);

/** Número que envia os alertas (só dígitos, com DDI). Vazio quando não configurado. */
export const whatsAppSender = () => process.env.WHATSAPP_SENDER ?? '';

/** Só dígitos; exige 10–15 após a limpeza. Lança em número inválido. */
export function normalizeNumber(number) {
  const normalized = String(number).replace(/\D/g, '');
  if (normalized.length < 10 || normalized.length > 15) {
    throw new Error(`Número de WhatsApp inválido: ${number}`);
  }
  return normalized;
}

/** `WHATSAPP_RECIPIENTS` (array JSON) → lista de números normalizados. Lança se vazio/inválido. */
export function whatsAppRecipients() {
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
