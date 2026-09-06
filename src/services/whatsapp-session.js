// Casos de uso da sessão do WhatsApp Web (o menu "Gerenciar notificações"):
// validar/salvar a sessão e desvincular o aparelho. O envio de mensagens fica
// em `notifier.js`; a mecânica de conexão, em `adapters/whatsapp-client.js`.

import { report } from '../logger.js';
import {
  clearWhatsAppSessionFiles,
  connectWhatsApp,
  whatsAppSessionExists,
  withWhatsApp,
} from '../adapters/whatsapp-client.js';

const waStatus = (message) => report('WHATSAPP', message);

/**
 * Conecta e espera o `ready` (mostrando o QR Code se não houver sessão salva),
 * depois fecha. Serve para parear um número novo ou revalidar a sessão atual.
 */
export async function validateSession({ onStatus = waStatus } = {}) {
  await withWhatsApp(() => {}, { onStatus });
}

/**
 * Desvincula o aparelho no WhatsApp (quando possível) e remove a sessão local.
 * Falha no desvínculo remoto → só a sessão local é apagada.
 */
export async function logout({ onStatus = waStatus } = {}) {
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
