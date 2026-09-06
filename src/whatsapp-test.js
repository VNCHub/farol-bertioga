import 'dotenv/config';
import { report } from './logger.js';
import { sendWhatsAppAlert, withWhatsApp } from './whatsapp-client.js';

const onStatus = (message) => report('WHATSAPP', message);

report('WHATSAPP', 'iniciando cliente de teste');

try {
  const recipients = await withWhatsApp(
    (client) => sendWhatsAppAlert(
      client,
      'Teste do monitor Sesc Bertioga: o cliente de alertas do WhatsApp está conectado.',
      { onStatus },
    ),
    { onStatus },
  );
  report('WHATSAPP', `teste enviado — ${recipients.join(', ')}`);
} catch (error) {
  report('WHATSAPP', `FALLBACK: ${error.message}`);
  process.exitCode = 1;
}
