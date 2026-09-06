// Driver do portal de reservas do Sesc: tudo que conhece o HTML/os seletores do
// site (`#logEmail`, "Nova hospedagem", "Nenhum mês aberto", os iframes aninhados).
// É a parte que muda quando o portal muda — separada do loop de `monitor.js`, que
// só orquestra retries e recuperação de falhas.

import { report as defaultReport } from '../logger.js';
import { PORTAL_URL, portalCredentials } from '../config.js';

const NO_AVAILABILITY_TEXT = 'Nenhum mês aberto';

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

export async function login(page, report = defaultReport) {
  const { login: user, senha } = portalCredentials();

  report('ABRINDO PÁGINA DE RESERVAS');
  await page.goto(PORTAL_URL, { waitUntil: 'commit', timeout: 45_000 });
  const loginContext = await waitForLoginContext(page);

  await fillFirst(loginContext, ['#logEmail'], user);
  report('CAMPO DE LOGIN ENCONTRADO');
  await fillFirst(loginContext, ['#logPassword'], senha);
  report('CAMPO DE SENHA ENCONTRADO');

  const submit = loginContext.locator('#btnLogin');
  await submit.waitFor({ state: 'visible', timeout: 30_000 });
  await submit.click();
  report('LOGIN ENVIADO');

  await page.waitForTimeout(2_000);
}

export async function openNewStay(page, report = defaultReport) {
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
