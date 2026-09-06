// Script de fumaça: sobe o WhatsApp, envia a mensagem de teste e fecha.
// Equivale à opção "Testar envio" da CLI, para quem prefere linha de comando.
import 'dotenv/config';
import { report } from './logger.js';
import { sendTestMessage } from './services/notifier.js';

report('WHATSAPP', 'iniciando cliente de teste');

try {
  const recipients = await sendTestMessage();
  report('WHATSAPP', `teste enviado — ${recipients.join(', ')}`);
} catch (error) {
  report('WHATSAPP', `FALLBACK: ${error.message}`);
  process.exitCode = 1;
}
