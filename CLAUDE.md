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

| Caminho | Papel |
| --- | --- |
| `src/cli.js` | **Entrypoint principal.** Menu interativo (`@inquirer/prompts`): iniciar monitoramento (com/sem alertas), login/logout do WhatsApp, teste de envio. |
| `src/monitor.js` | Exporta `runMonitor({ once, signal, report, onAlert })`. Login no portal, abre "Nova hospedagem", lê a disponibilidade. `onAlert({ kind })` é chamada com `kind: 'available'` (vaga) e `kind: 'fallback'` (resposta inesperada). Também executável direto (`node src/monitor.js [--once]`). |
| `src/alerts.js` | `createAlertDispatcher()` → função `onAlert` com rate-limit de **1 alerta a cada 10 min** (soma vaga + fallback). `now`/`send` injetáveis para teste. |
| `src/whatsapp-client.js` | Cliente WhatsApp sem estado: `withWhatsApp` (connect→ação→destroy, o padrão de uso), `connectWhatsApp`, `sendWhatsAppAlert`, `logoutWhatsApp`, `whatsAppSessionExists`, `clearWhatsAppSessionFiles`. Ao criar o cliente, `sanitizeBrowserProfile()` zera abas/locks do perfil Chromium (mata Chromium órfão pelo `SingletonLock`) — só a auth do WhatsApp persiste. |
| `src/whatsapp-test.js` | Script de fumaça: conecta o WhatsApp e envia uma mensagem de teste aos destinatários. |
| `src/logger.js` | `timestamp()` e `report(status, details)` — formato de log compartilhado. |
| `.env` / `.env.example` | Credenciais e configuração. O `.env` real é ignorado pelo Git. |
| `.wwebjs_auth/`, `.wwebjs_cache/` | Sessão persistida do WhatsApp Web. Não versionar. |
| `docs/` | Documentação de arquitetura e configuração. |
| `test/` | Testes unitários (Vitest). Cobrem `alerts.js`, `logger.js`, e as funções puras de `monitor.js` (`checkAvailability`, `sleep`) e `whatsapp-client.js` (`normalizeNumber`, `recipientsFromEnv`, `numberFromEnv`, `waitForServerAck`). Não sobem navegador nem rede. |

## Comandos

```bash
npm install
npx playwright install chromium      # baixa o navegador uma vez

npm start              # CLI com menu interativo (node src/cli.js) — uso normal
npm run login          # uma consulta única, Chromium visível (node src/monitor.js --once)
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
- Configuração sempre via `process.env`, lida com `import 'dotenv/config'` no topo do
  entrypoint. Falha cedo e explícito quando falta variável obrigatória.
- **WhatsApp é sempre `connect → ação → destroy`** (use `withWhatsApp`). Nada de cliente
  persistente. Só a autenticação persiste em `.wwebjs_auth/`; abas/janelas/locks do
  perfil Chromium são zerados a cada conexão por `sanitizeBrowserProfile()`. Isso garante
  1 janela por vez sem precisar de estado compartilhado entre execuções.

## Estado atual / lacunas conhecidas

Veja `KNOWN_ISSUES.md`. Monitor e WhatsApp **estão integrados**: `runMonitor` chama
`onAlert` em vaga (`kind: 'available'`) e em resposta inesperada (`kind: 'fallback'`), e
o despachante de `alerts.js` envia por WhatsApp respeitando o limite de 1 a cada 10 min.
Hoje só o caminho `'fallback'` dispara de fato — **`checkAvailability` ainda não tem
regra positiva de vaga** e nunca retorna `'available'`.

## Segredos

`.env`, `.wwebjs_auth/` e `.wwebjs_cache/` contêm credenciais e sessão autenticada.
Nunca commitar, colar em logs, nem enviar a serviços externos.
