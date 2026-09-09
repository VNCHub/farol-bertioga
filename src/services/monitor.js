// Loop de monitoramento: orquestra o ciclo de vida do Chromium, os retries e a
// recuperação de falhas. As interações com o site ficam em `adapters/portal.js`.

import 'dotenv/config';
import { pathToFileURL } from 'node:url';
import { chromium } from 'playwright';
import { report as defaultReport } from '../logger.js';
import {
  BROWSER_RESTART_MS,
  MONITOR_INTERVAL_MS,
  PORTAL_HEADED,
  portalCredentials,
} from '../config.js';
import { checkAvailability, login, openNewStay } from '../adapters/portal.js';

// Espera abortável: resolve no prazo OU imediatamente se o signal for abortado.
export function sleep(ms, signal) {
  return new Promise((resolve) => {
    if (signal?.aborted) return resolve();
    const onAbort = () => {
      clearTimeout(timer);
      resolve();
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

/**
 * Loop de monitoramento do portal.
 *
 * @param {object}      [options]
 * @param {boolean}     [options.once]    Uma única consulta e retorna.
 * @param {AbortSignal} [options.signal]  Aborta o loop de forma limpa (sem matar o processo).
 * @param {Function}    [options.report]  `(status, details?) => void` para a saída.
 * @param {Function}    [options.onAlert] Assíncrona, `({ kind, months, details }) => void`. Chamada com
 *                                        `kind: 'available'` (+ `months`: rótulos com vaga) quando o
 *                                        portal abre o passo "Períodos" com `Disponíveis (N ≥ 1)`, e
 *                                        `kind: 'fallback'` quando o portal dá resposta inesperada.
 *                                        Mês listado sem período (`'sem-periodo'`) só é logado, não alerta.
 *                                        Passe só quando quiser alertas; o rate-limit é do chamador.
 */
export async function runMonitor({
  once = false,
  signal,
  report = defaultReport,
  onAlert,
} = {}) {
  portalCredentials(); // falha cedo se LOGIN/SENHA não estiverem no .env

  while (!signal?.aborted) {
    let browser;
    let page;
    let restartRequired = false;

    try {
      browser = await chromium.launch({ headless: !PORTAL_HEADED, slowMo: PORTAL_HEADED ? 250 : 0 });
      page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
      report('CHROMIUM ABERTO');
      await login(page, report);

      do {
        try {
          await openNewStay(page, report);
          const { status, availableMonths } = await checkAvailability(page, report);
          if (status === 'available') {
            await onAlert?.({ kind: 'available', months: availableMonths });
          } else if (status === 'unknown') {
            // checkAvailability já logou o FALLBACK: RESPOSTA INESPERADA.
            await onAlert?.({ kind: 'fallback', details: 'resposta inesperada do portal' });
          }
          // 'sem-periodo' e 'unavailable': checkAvailability já logou; nada a alertar.
        } catch (error) {
          const message = error.message ?? String(error);
          report('FALLBACK: FALHA NO PROCESSO', message);
          if (message.startsWith('SESSÃO EXPIRADA:')) break;
          if (page.isClosed() || /browser has been closed|target page, context or browser has been closed/i.test(message)) {
            restartRequired = true;
            break;
          }
        }
        if (!once && !signal?.aborted) await sleep(MONITOR_INTERVAL_MS, signal);
      } while (!once && !signal?.aborted);
    } catch (error) {
      const message = error.message ?? String(error);
      report('FALLBACK: CHROMIUM', message);
      restartRequired = !once;
    } finally {
      await page?.close().catch(() => {});
      await browser?.close().catch(() => {});
    }

    if (once || !restartRequired || signal?.aborted) break;
    report('REABRINDO CHROMIUM', `nova tentativa em ${BROWSER_RESTART_MS / 1000}s`);
    await sleep(BROWSER_RESTART_MS, signal);
  }
}

// Execução direta: `node src/services/monitor.js [--once]` (`npm run login` / `npm run monitor`).
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const once = process.argv.includes('--once');
  const controller = new AbortController();
  for (const sig of ['SIGINT', 'SIGTERM']) {
    process.once(sig, () => controller.abort());
  }
  runMonitor({ once, signal: controller.signal }).catch((error) => {
    defaultReport('FALLBACK: ERRO FATAL', error.message ?? String(error));
    process.exitCode = 1;
  });
}
