# CLAUDE.md

Guia para agentes que trabalham neste repositório.

## O que é

Monitor não oficial de disponibilidade de reservas do **Centro de Férias Sesc Bertioga**.
O portal (`https://centrodeferias.sescsp.org.br/reservas/`) não oferece API nem notificação
de vagas; o projeto automatiza o navegador para consultar o portal periodicamente e,
no futuro, disparar alertas por WhatsApp para um grupo pequeno de contatos.

## Stack

- Node.js (>= 20, testado no v24), ESM puro (`"type": "module"`).
- [Playwright](https://playwright.dev/) (Chromium) para a automação do portal.
- [whatsapp-web.js](https://wwebjs.dev/) + `qrcode-terminal` para o canal de alertas.
- [`@inquirer/prompts`](https://github.com/SBoudrias/Inquirer.js) para o menu interativo da CLI.
- `dotenv` para configuração via `.env`.
- [Vitest](https://vitest.dev/) para os testes unitários (`test/`). Sem linter, sem build.
  CI no GitHub Actions (`.github/workflows/test.yml`) roda `npm test` a cada push/PR.

## Estrutura

Três camadas: **base** (`config`, `logger`) → **adapters** (falam uma lib/protocolo) →
**services** (regra/orquestração) → **entrypoints** (fiação). Regra de dependência:
entrypoints → services → adapters → base; adapter nunca importa service; só `config.js`
lê `process.env`.

| Caminho | Papel |
| --- | --- |
| `src/cli.js` | **Entrypoint principal.** Menu interativo (`@inquirer/prompts`); roteia escolha de menu → chamada de serviço. |
| `src/whatsapp-test.js` | **Entrypoint.** Script de fumaça: `sendTestMessage()`. |
| `src/config.js` | **base.** Toda leitura de `process.env` + constantes ajustáveis (`PORTAL_URL`, `MONITOR_INTERVAL_MS`, `BROWSER_RESTART_MS`, paths do perfil WhatsApp), `portalCredentials()`, `normalizeNumber`, `whatsAppRecipients`. Não carrega `.env`. |
| `src/logger.js` | **base.** `timestamp()` e `report(status, details)`. |
| `src/adapters/portal.js` | Driver do portal: tudo acoplado ao HTML/seletores (`login`, `openNewStay`, `checkAvailability`, iframes). Muda quando o portal muda. |
| `src/adapters/whatsapp-client.js` | Adapter whatsapp-web.js: `withWhatsApp` (connect→ação→destroy), `connectWhatsApp`, `waitForServerAck`, `whatsAppSessionExists`, `clearWhatsAppSessionFiles`. Sem noção de destinatário/alerta. |
| `src/adapters/browser-profile.js` | `sanitizeBrowserProfile()` / `closeStrayPages()`: zera abas/locks do perfil Chromium (mata Chromium órfão pelo `SingletonLock`). |
| `src/services/monitor.js` | `runMonitor({ once, signal, report, onAlert })` — só o **loop**: lifecycle do Chromium, retries, despacho de `onAlert`. Executável direto (`node src/services/monitor.js [--once]`). |
| `src/services/notifier.js` | `createAlertDispatcher()` (rate-limit **1 alerta / 10 min**), `sendWhatsAppAlert()`, `sendTestMessage()`, `ALERT_MESSAGES`, `TEST_MESSAGE`. `now`/`send` injetáveis. |
| `src/services/whatsapp-session.js` | `validateSession()` / `logout()` — casos de uso do menu "Gerenciar notificações". |
| `.env` / `.env.example` | Credenciais e configuração. O `.env` real é ignorado pelo Git. |
| `.wwebjs_auth/`, `.wwebjs_cache/` | Sessão persistida do WhatsApp Web. Não versionar. |
| `docs/` | Documentação de arquitetura e configuração. |
| `test/` | Testes unitários (Vitest). Cobrem `config.js`, `logger.js`, `adapters/portal.js` (`checkAvailability`), `adapters/whatsapp-client.js` (`waitForServerAck`), `services/monitor.js` (`sleep`) e `services/notifier.js` (`createAlertDispatcher`). Não sobem navegador nem rede. |

## Comandos

```bash
npm install
npx playwright install chromium      # baixa o navegador uma vez

npm start              # CLI com menu interativo (node src/cli.js) — uso normal
npm run login          # uma consulta única, Chromium visível (node src/services/monitor.js --once)
npm run monitor        # consulta a cada 60s até Ctrl+C
npm run whatsapp:test  # conecta o WhatsApp (QR Code) e manda mensagem de teste

npm test               # testes unitários (Vitest, sem navegador)
npm run test:watch     # Vitest em modo watch
```

## Convenções observadas no código

- **Mensagens e logs em português**, em CAIXA ALTA para o status (`report(status, details)`).
  Timestamps no fuso `America/Sao_Paulo`, formato ISO-like (`sv-SE`).
- **Nunca classificar uma vaga como disponível por suposição.** O código só reconhece a
  ausência de vaga (texto `Nenhum mês aberto`). Qualquer outra resposta vira
  `FALLBACK: ...` justamente para não gerar falso positivo. Preserve essa postura
  conservadora ao evoluir `checkAvailability`.
- O portal usa **iframes** e demora a liberar o formulário; o código varre `page.frames()`
  com deadlines generosos (até 90s no login). Mantenha esse padrão de espera.
- Erros de sessão expirada começam com o prefixo `SESSÃO EXPIRADA:` e quebram o loop
  interno de propósito.
- Configuração sempre via `src/config.js` — nenhum outro módulo lê `process.env`.
  O entrypoint faz `import 'dotenv/config'` no topo; `config.js` valida e falha cedo
  e explícito quando falta variável obrigatória (`portalCredentials()`).
- **WhatsApp é sempre `connect → ação → destroy`** (use `withWhatsApp`). Nada de cliente
  persistente. Só a autenticação persiste em `.wwebjs_auth/`; abas/janelas/locks do
  perfil Chromium são zerados a cada conexão por `sanitizeBrowserProfile()`. Isso garante
  1 janela por vez sem precisar de estado compartilhado entre execuções.
- **Onde colocar código novo:** lógica que fala com um SDK/site → `adapters/`; regra,
  orquestração ou caso de uso → `services/`; `cli.js`/`whatsapp-test.js` só ligam um ao
  outro. Um `adapters/*` não importa `services/*`. A CLI e os scripts diretos devem
  chamar **a mesma** função de serviço (ex.: `notifier.sendTestMessage`).

## Estado atual / lacunas conhecidas

Veja `KNOWN_ISSUES.md`. Monitor e WhatsApp **estão integrados**: `runMonitor` chama
`onAlert` em vaga (`kind: 'available'`) e em resposta inesperada (`kind: 'fallback'`), e
o despachante de `alerts.js` envia por WhatsApp respeitando o limite de 1 a cada 10 min.
Hoje só o caminho `'fallback'` dispara de fato — **`checkAvailability` ainda não tem
regra positiva de vaga** e nunca retorna `'available'`.

## Segredos

`.env`, `.wwebjs_auth/` e `.wwebjs_cache/` contêm credenciais e sessão autenticada.
Nunca commitar, colar em logs, nem enviar a serviços externos.
