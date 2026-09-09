// Driver do portal de reservas do Sesc: tudo que conhece o HTML/os seletores do
// site (`#logEmail`, "Nova hospedagem", "Nenhum mês aberto", os iframes aninhados).
// É a parte que muda quando o portal muda — separada do loop de `monitor.js`, que
// só orquestra retries e recuperação de falhas.

import { report as defaultReport } from '../logger.js';
import { PORTAL_URL, portalCredentials, canonicalMonthLabel } from '../config.js';

const NO_AVAILABILITY_TEXT = 'Nenhum mês aberto';
const MONTHS_HEADING = /meses?\s+dispon[ií]veis/i;
const MONTH_PILL_SELECTOR = 'button[ng-click^="setPeriodo"]';
const NO_PERIOD_TEXT = /(n[ãa]o h[áa]|n[ãa]o existem)\s+per[ií]odos\s+dispon[ií]veis/i;
const PERIOD_COUNT_TEXT = /dispon[ií]ve(?:l|is)\s*\(\s*(\d+)\s*\)/i;

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

// Procura o link/botão "Nova hospedagem" em qualquer frame; null se não aparecer no prazo.
async function findNewStay(page, timeout = 20_000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    for (const frame of page.frames()) {
      const newStay = frame.getByText(/nova hospedagem/i).first();
      if (await newStay.isVisible().catch(() => false)) return newStay;
    }
    await page.waitForTimeout(500);
  }
  return null;
}

// True enquanto algum frame ainda mostra o formulário de login do Portal SescSP.
async function loginFormVisible(page) {
  const flags = await Promise.all(
    page.frames().map((frame) => frame.locator('#logEmail, #logPassword').first().isVisible().catch(() => false)),
  );
  return flags.some(Boolean);
}

async function submitLoginForm(loginContext, user, senha) {
  await fillFirst(loginContext, ['#logEmail'], user);
  await fillFirst(loginContext, ['#logPassword'], senha);
  // O login do portal é AngularJS: sem uma pausa após preencher, o clique no
  // botão dispara o submit nativo (GET com a senha na URL) sem autenticar.
  await loginContext.page().waitForTimeout(1_000);
  const submit = loginContext.locator('#btnLogin');
  await submit.waitFor({ state: 'visible', timeout: 30_000 });
  await submit.click();
}

export async function login(page, report = defaultReport) {
  const { login: user, senha } = portalCredentials();

  report('ABRINDO PÁGINA DE RESERVAS');
  await page.goto(PORTAL_URL, { waitUntil: 'commit', timeout: 45_000 });

  const attempts = 3;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const loginContext = await waitForLoginContext(page);
    if (attempt === 1) report('CAMPO DE LOGIN ENCONTRADO');

    await submitLoginForm(loginContext, user, senha);
    report(attempt === 1 ? 'LOGIN ENVIADO' : `LOGIN ENVIADO (tentativa ${attempt})`);

    // Espera o formulário de login sumir — sinal de que o SSO autenticou.
    const deadline = Date.now() + 20_000;
    while (Date.now() < deadline && await loginFormVisible(page)) {
      await page.waitForTimeout(1_000);
    }
    if (!(await loginFormVisible(page))) {
      await page.waitForTimeout(2_000);
      return;
    }
    report('LOGIN', `portal ainda pede login; nova tentativa (${attempt}/${attempts})`);
    await page.goto(PORTAL_URL, { waitUntil: 'commit', timeout: 45_000 });
  }
  throw new Error('SESSÃO EXPIRADA: não foi possível autenticar no portal após 3 tentativas. Confira LOGIN/SENHA no .env.');
}

export async function openNewStay(page, report = defaultReport) {
  // O portal só libera os recursos após um reload da tela de reservas, e o
  // cookie de SSO pode demorar alguns segundos para valer — tenta algumas vezes
  // antes de concluir que a sessão expirou.
  const attempts = 4;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    await page.goto(PORTAL_URL, { waitUntil: 'commit', timeout: 45_000 });
    await page.reload({ waitUntil: 'commit', timeout: 45_000 });
    await page.waitForTimeout(2_000);

    const newStay = await findNewStay(page, 20_000);
    if (newStay) {
      report('NOVA HOSPEDAGEM ENCONTRADA');
      await newStay.click();
      await page.waitForTimeout(1_500);
      return;
    }
    if (attempt < attempts) {
      report('AGUARDANDO SESSÃO', `o portal ainda não liberou "Nova hospedagem" (${attempt}/${attempts - 1})`);
      await page.waitForTimeout(5_000);
    }
  }
  throw new Error('SESSÃO EXPIRADA: o portal continuou pedindo login. Reinicie o monitor para autenticar novamente.');
}

// --- Núcleo puro (testável, sem Playwright) -----------------------------

/**
 * Lê a contagem "Disponíveis (N)" do texto do passo "Períodos".
 * - "Não há/Não existem períodos disponíveis" → 0 (o portal listou o mês, mas sem vaga).
 * - "Disponíveis (N)" → N.
 * - nada reconhecível → `null` (indeciso; o chamador trata como resposta inesperada).
 */
export function parsePeriodCount(panelText = '') {
  if (NO_PERIOD_TEXT.test(panelText)) return 0;
  const match = panelText.match(PERIOD_COUNT_TEXT);
  return match ? Number(match[1]) : null;
}

/**
 * Classifica a disponibilidade a partir do texto da página e dos meses inspecionados.
 *
 * @param {object}   input
 * @param {string}   [input.pageText]  Texto concatenado dos frames.
 * @param {Array<{ label: string, count: number|null }>} [input.months]
 * @returns {{ status: 'available'|'sem-periodo'|'unavailable'|'unknown',
 *            availableMonths: string[], listedMonths: string[] }}
 */
export function classifyAvailability({ pageText = '', months = [] } = {}) {
  if (pageText.toLocaleLowerCase('pt-BR').includes(NO_AVAILABILITY_TEXT.toLocaleLowerCase('pt-BR'))) {
    return { status: 'unavailable', availableMonths: [], listedMonths: [] };
  }

  const availableMonths = months.filter((m) => m.count > 0).map((m) => m.label);
  const listedMonths = months.filter((m) => m.count === 0).map((m) => m.label);

  if (availableMonths.length > 0) return { status: 'available', availableMonths, listedMonths };
  if (listedMonths.length > 0) return { status: 'sem-periodo', availableMonths, listedMonths };
  return { status: 'unknown', availableMonths: [], listedMonths: [] };
}

// --- Interação com o navegador (fina; sem teste unitário, como runMonitor) ---

async function readAllFramesText(page) {
  const parts = await Promise.all(
    page.frames().map((frame) => frame.locator('body').innerText().catch(() => '')),
  );
  return parts.join('\n');
}

// Acha o frame que já mostra "Meses disponíveis" com pelo menos uma pill de mês.
async function waitForMonthsFrame(page, timeout = 30_000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    for (const frame of page.frames()) {
      const heading = frame.getByText(MONTHS_HEADING).first();
      const pill = frame.locator(MONTH_PILL_SELECTOR).first();
      if (await heading.isVisible().catch(() => false)
        && await pill.isVisible().catch(() => false)) {
        return frame;
      }
    }
    await page.waitForTimeout(500);
  }
  return null;
}

// Depois de clicar numa pill, espera o passo "Períodos" assentar (contagem ou "não há").
async function waitForPeriodPanel(page, timeout = 20_000) {
  const deadline = Date.now() + timeout;
  let text = '';
  while (Date.now() < deadline) {
    text = await readAllFramesText(page);
    if (PERIOD_COUNT_TEXT.test(text) || NO_PERIOD_TEXT.test(text)) return text;
    await page.waitForTimeout(500);
  }
  return text;
}

/**
 * Determina a disponibilidade do portal. Retorna
 * `{ status, availableMonths, listedMonths }` — ver `classifyAvailability`.
 *
 * Postura conservadora: só reconhece vaga (`'available'`) quando um mês listado
 * abre o passo "Períodos" com `Disponíveis (N ≥ 1)`. Mês listado com
 * `Disponíveis (0)` → `'sem-periodo'` (o monitor loga, mas não alerta).
 */
export async function checkAvailability(page, report = defaultReport) {
  const pageText = await readAllFramesText(page);

  if (pageText.toLocaleLowerCase('pt-BR').includes(NO_AVAILABILITY_TEXT.toLocaleLowerCase('pt-BR'))) {
    report('VAGA NÃO DISPONÍVEL');
    return classifyAvailability({ pageText });
  }

  const monthsFrame = await waitForMonthsFrame(page);
  if (!monthsFrame) {
    report('FALLBACK: RESPOSTA INESPERADA', 'não foi encontrada a lista de meses nem a indisponibilidade');
    return classifyAvailability({ pageText });
  }

  const pills = monthsFrame.locator(MONTH_PILL_SELECTOR);
  const rawLabels = await pills.allInnerTexts();
  const months = [];
  for (let i = 0; i < rawLabels.length; i += 1) {
    const label = canonicalMonthLabel(rawLabels[i]) ?? rawLabels[i].replace(/\s+/g, ' ').trim();
    await pills.nth(i).click();
    const panelText = await waitForPeriodPanel(page);
    months.push({ label, count: parsePeriodCount(panelText) });
  }

  const result = classifyAvailability({ pageText, months });
  if (result.status === 'available') {
    report('VAGA DISPONÍVEL', result.availableMonths.join(', '));
  } else if (result.status === 'sem-periodo') {
    report('MÊS SEM PERÍODO', result.listedMonths.join(', '));
  } else {
    report('FALLBACK: RESPOSTA INESPERADA', 'meses listados, mas sem contagem de períodos legível');
  }
  return result;
}
