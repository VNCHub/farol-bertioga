import 'dotenv/config';
import { pathToFileURL } from 'node:url';
import { chromium } from 'playwright';
import { report as defaultReport } from './logger.js';

const PORTAL_URL = 'https://centrodeferias.sescsp.org.br/reservas/';
const NO_AVAILABILITY_TEXT = 'Nenhum mês aberto';
const INTERVAL_MS = 60_000;
const BROWSER_RESTART_MS = 5_000;

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

async function fillFirst(page, selectors, value) {
  const field = page.locator(selectors.join(', ')).first();
  await field.waitFor({ state: 'visible', timeout: 30_000 });
  await field.fill(value);
}

async function waitForLoginContext(page) {
  const loginSelectors = ['#logEmail'];
  // O iframe do portal pode levar mais de um minuto até liberar o formulário.
  const deadline = Date.now() + 90_000;

  while (Date.now() < deadline) {
    for (const frame of page.frames()) {
      const field = frame.locator(loginSelectors.join(', ')).first();
      if (await field.isVisible().catch(() => false)) return frame;
    }
    await page.waitForTimeout(500);
  }
  throw new Error('Campo de login/CPF não encontrado após 90 segundos.');
}

async function findNewStayOrExpiredSession(page, timeout = 30_000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    for (const frame of page.frames()) {
      const newStay = frame.getByText(/nova hospedagem/i).first();
      if (await newStay.isVisible().catch(() => false)) return newStay;

      const loginField = frame.locator('#logEmail');
      if (await loginField.isVisible().catch(() => false)) {
        throw new Error('SESSÃO EXPIRADA: o portal voltou a solicitar login. Reinicie o monitor para autenticar novamente.');
      }
    }
    await page.waitForTimeout(500);
  }
  throw new Error('Nova hospedagem não foi encontrada após 30 segundos.');
}

async function login(page, report) {
  report('ABRINDO PÁGINA DE RESERVAS');
  await page.goto(PORTAL_URL, { waitUntil: 'commit', timeout: 45_000 });
  const loginContext = await waitForLoginContext(page);

  await fillFirst(loginContext, ['#logEmail'], process.env.LOGIN);
  report('CAMPO DE LOGIN ENCONTRADO');
  await fillFirst(loginContext, ['#logPassword'], process.env.SENHA);
  report('CAMPO DE SENHA ENCONTRADO');

  const submit = loginContext.locator('#btnLogin');
  await submit.waitFor({ state: 'visible', timeout: 30_000 });
  await submit.click();
  report('LOGIN ENVIADO');

  await page.waitForTimeout(2_000);
}

async function openNewStay(page, report) {
  // O portal só disponibiliza os recursos após um reload da tela de reservas.
  await page.goto(PORTAL_URL, { waitUntil: 'commit', timeout: 45_000 });
  await page.reload({ waitUntil: 'commit', timeout: 45_000 });
  await page.waitForTimeout(1_500);

  const newStay = await findNewStayOrExpiredSession(page);
  report('NOVA HOSPEDAGEM ENCONTRADA');
  await newStay.click();
  await page.waitForTimeout(1_500);
}

// Retorna 'unavailable' quando o portal confirma que não há mês aberto e
// 'unknown' para qualquer outra resposta (nunca afirma que há vaga por suposição).
// TODO: quando o texto/elemento positivo de vaga estiver identificado com segurança,
//       retornar 'available' aqui — runMonitor já dispara o alerta nesse caso.
export async function checkAvailability(page, report = defaultReport) {
  const text = await Promise.all(page.frames().map((frame) => frame.locator('body').innerText().catch(() => '')));
  if (text.join('\n').toLocaleLowerCase('pt-BR').includes(NO_AVAILABILITY_TEXT.toLocaleLowerCase('pt-BR'))) {
    report('VAGA NÃO DISPONÍVEL');
    return 'unavailable';
  }

  report('FALLBACK: RESPOSTA INESPERADA', 'não foi encontrada a mensagem de indisponibilidade');
  return 'unknown';
}

/**
 * Loop de monitoramento do portal.
 *
 * @param {object}      [options]
 * @param {boolean}     [options.once]    Uma única consulta e retorna.
 * @param {AbortSignal} [options.signal]  Aborta o loop de forma limpa (sem matar o processo).
 * @param {Function}    [options.report]  `(status, details?) => void` para a saída.
 * @param {Function}    [options.onAlert] Assíncrona, `({ kind, details }) => void`. Chamada com
 *                                        `kind: 'available'` quando uma vaga é confirmada e
 *                                        `kind: 'fallback'` quando o portal dá resposta inesperada.
 *                                        Passe só quando quiser alertas; o rate-limit é do chamador.
 */
export async function runMonitor({
  once = false,
  signal,
  report = defaultReport,
  onAlert,
} = {}) {
  if (!process.env.LOGIN || !process.env.SENHA) {
    throw new Error('Defina LOGIN e SENHA no arquivo .env antes de executar.');
  }
  const headed = process.env.HEADLESS !== 'true';

  while (!signal?.aborted) {
    let browser;
    let page;
    let restartRequired = false;

    try {
      browser = await chromium.launch({ headless: !headed, slowMo: headed ? 250 : 0 });
      page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
      report('CHROMIUM ABERTO');
      await login(page, report);

      do {
        try {
          await openNewStay(page, report);
          const availability = await checkAvailability(page, report);
          if (availability === 'available') {
            report('VAGA DISPONÍVEL');
            await onAlert?.({ kind: 'available' });
          } else if (availability === 'unknown') {
            // checkAvailability já logou o FALLBACK: RESPOSTA INESPERADA.
            await onAlert?.({ kind: 'fallback', details: 'resposta inesperada do portal' });
          }
        } catch (error) {
          const message = error.message ?? String(error);
          report('FALLBACK: FALHA NO PROCESSO', message);
          if (message.startsWith('SESSÃO EXPIRADA:')) break;
          if (page.isClosed() || /browser has been closed|target page, context or browser has been closed/i.test(message)) {
            restartRequired = true;
            break;
          }
        }
        if (!once && !signal?.aborted) await sleep(INTERVAL_MS, signal);
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

// Execução direta: `node src/monitor.js [--once]` (mantém `npm run login` / `npm run monitor`).
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
