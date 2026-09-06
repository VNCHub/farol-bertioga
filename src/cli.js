#!/usr/bin/env node
import 'dotenv/config';
import { select, confirm } from '@inquirer/prompts';
import { report } from './logger.js';
import { createAlertDispatcher, sendTestMessage } from './services/notifier.js';
import { runMonitor } from './services/monitor.js';
import { logout as logoutWhatsApp, validateSession } from './services/whatsapp-session.js';
import { whatsAppSessionExists } from './adapters/whatsapp-client.js';

const waStatus = (message) => report('WHATSAPP', message);

// Um só despachante para toda a vida da CLI: o limite de 10 min sobrevive a
// parar e reiniciar o monitoramento pelo menu.
const dispatchAlert = createAlertDispatcher({ onStatus: waStatus });

// O select do @inquirer lança ExitPromptError no Ctrl+C; tratamos como "voltar".
const CANCELLED = Symbol('cancelled');
async function ask(promptPromise) {
  try {
    return await promptPromise;
  } catch (error) {
    if (error?.name === 'ExitPromptError') return CANCELLED;
    throw error;
  }
}

// --- 1. Monitoramento ------------------------------------------------------

async function runMonitoringSession(withAlerts) {
  if (withAlerts && !whatsAppSessionExists()) {
    report('MONITORAMENTO', 'sem sessão de WhatsApp — faça login em "Gerenciar notificações" antes de usar alertas.');
    return;
  }

  // Em vaga confirmada ou fallback: sobe o WhatsApp, envia e fecha (respeitando o
  // limite de 1 alerta / 10 min).
  const onAlert = withAlerts ? dispatchAlert : undefined;

  const controller = new AbortController();
  let interrupts = 0;
  const onSigint = () => {
    interrupts += 1;
    if (interrupts === 1) {
      controller.abort();
      report('MONITORAMENTO', 'encerrando o ciclo atual... (Ctrl+C de novo força a saída)');
    } else {
      process.exit(130);
    }
  };
  process.on('SIGINT', onSigint);

  report('MONITORAMENTO', withAlerts ? 'iniciado (com alertas)' : 'iniciado (sem alertas)');
  if (withAlerts) report('MONITORAMENTO', 'alerta em vaga ou fallback; no máximo 1 a cada 10 min; WhatsApp conecta só no envio.');
  console.log('  Ctrl+C volta ao menu.\n');

  try {
    await runMonitor({ signal: controller.signal, report, onAlert });
  } catch (error) {
    report('MONITORAMENTO', `FALLBACK: ${error.message}`);
  } finally {
    process.removeListener('SIGINT', onSigint);
    report('MONITORAMENTO', 'encerrado');
  }
}

async function monitoringMenu() {
  const choice = await ask(select({
    message: 'Monitoramento',
    choices: [
      { name: 'Com alertas por WhatsApp', value: 'alerts', description: 'Envia alerta em vaga confirmada ou resposta inesperada do portal. Máximo 1 mensagem a cada 10 min.' },
      { name: 'Sem alertas (só observar)', value: 'plain', description: 'Consulta o portal e imprime o status no terminal.' },
      { name: 'Voltar', value: 'back' },
    ],
  }));

  if (choice === CANCELLED || choice === 'back') return;
  await runMonitoringSession(choice === 'alerts');
}

// --- 2. Notificações por WhatsApp ----------------------------------------

async function whatsAppLogin() {
  if (whatsAppSessionExists()) {
    report('WHATSAPP', 'já existe uma sessão salva. Use "Logout" antes de trocar de número.');
    const proceed = await ask(confirm({ message: 'Reconectar mesmo assim para validar a sessão?', default: false }));
    if (proceed !== true) return;
  } else {
    report('WHATSAPP', 'nenhuma sessão salva — o QR Code aparecerá abaixo.');
  }

  try {
    await validateSession({ onStatus: waStatus });
    report('WHATSAPP', 'sessão validada e salva em .wwebjs_auth/. Janela fechada.');
  } catch (error) {
    report('WHATSAPP', `FALLBACK: ${error.message}`);
  }
}

async function whatsAppLogout() {
  if (!whatsAppSessionExists()) {
    report('WHATSAPP', 'nenhuma sessão salva.');
    return;
  }
  const sure = await ask(confirm({ message: 'Desvincular o aparelho e apagar a sessão local?', default: false }));
  if (sure !== true) return;

  try {
    await logoutWhatsApp({ onStatus: waStatus });
  } catch (error) {
    report('WHATSAPP', `FALLBACK: ${error.message}`);
  }
}

async function whatsAppTestSend() {
  if (!whatsAppSessionExists()) {
    report('WHATSAPP', 'faça login antes de testar o envio.');
    return;
  }
  try {
    const recipients = await sendTestMessage({ onStatus: waStatus });
    report('WHATSAPP', `teste enviado — ${recipients.join(', ')}. Janela fechada.`);
  } catch (error) {
    report('WHATSAPP', `FALLBACK: ${error.message}`);
  }
}

async function whatsAppMenu() {
  while (true) {
    const hasSession = whatsAppSessionExists();
    const choice = await ask(select({
      message: `Notificações WhatsApp  [sessão: ${hasSession ? 'salva' : 'nenhuma'}]`,
      choices: [
        { name: hasSession ? 'Logout / desvincular aparelho' : 'Login / conectar (QR Code)', value: 'auth' },
        { name: 'Testar envio de mensagem', value: 'test' },
        { name: 'Voltar', value: 'back' },
      ],
    }));

    if (choice === CANCELLED || choice === 'back') return;
    if (choice === 'auth') await (hasSession ? whatsAppLogout() : whatsAppLogin());
    if (choice === 'test') await whatsAppTestSend();
  }
}

// --- Menu principal ------------------------------------------------------

async function main() {
  report('CLI', 'Monitor Sesc Bertioga');

  while (true) {
    const choice = await ask(select({
      message: 'Menu principal',
      choices: [
        { name: 'Iniciar monitoramento', value: 'monitor' },
        { name: 'Gerenciar notificações WhatsApp', value: 'whatsapp' },
        { name: 'Sair', value: 'exit' },
      ],
    }));

    if (choice === CANCELLED || choice === 'exit') break;
    if (choice === 'monitor') await monitoringMenu();
    if (choice === 'whatsapp') await whatsAppMenu();
  }

  report('CLI', 'até logo.');
  process.exit(0);
}

main().catch((error) => {
  report('CLI', `FALLBACK: ${error.message ?? error}`);
  process.exit(1);
});
