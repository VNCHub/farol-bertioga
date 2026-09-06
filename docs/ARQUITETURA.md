# Arquitetura

## Visão geral

```
                         .env (LOGIN, SENHA, WHATSAPP_*)
                           │
                           ▼
                     src/cli.js  ── menu interativo (@inquirer/prompts)
                     ┌─────┴───────────────┐
                     ▼                     ▼
             src/monitor.js         src/whatsapp-client.js
             runMonitor(...)        withWhatsApp: connect→ação→destroy
             (Playwright/Chromium)  (whatsapp-web.js)
                     │           ▲          │
       onAvailable ──┼───────────┘          ▼
                     ▼                WhatsApp Web ──► destinatários
        Portal de reservas Sesc
```

A CLI é o entrypoint e orquestra os dois fluxos. `runMonitor` chama `onAlert({ kind })`
em vaga (`'available'`) e em resposta inesperada (`'fallback'`); o despachante de
`alerts.js` envia por WhatsApp com limite de 1 a cada 10 min. Hoje só o `'fallback'`
dispara — a regra positiva de vaga ainda não existe (ver `KNOWN_ISSUES.md`).
`src/monitor.js` e `src/whatsapp-test.js` continuam executáveis direto, sem a CLI.

## `src/cli.js`

Entrypoint (`npm start`). Menu com `@inquirer/prompts`:

1. **Iniciar monitoramento** → submenu com/sem alertas.
   - *Sem alertas*: `runMonitor({ signal, report })`.
   - *Com alertas*: exige sessão de WhatsApp salva (`whatsAppSessionExists`); passa
     `onAlert = dispatchAlert` (de `alerts.js`) — o WhatsApp conecta só quando há um
     alerta a enviar e dentro do limite de 10 min; o Chromium fecha logo depois.
   - Um `AbortController` liga o `Ctrl+C` ao `signal` do `runMonitor`: o loop encerra
     limpo e volta ao menu, sem matar o processo.
2. **Gerenciar notificações WhatsApp** → login/logout (alterna conforme a sessão
   existente) e teste de envio. Cada ação abre o WhatsApp, faz o que precisa e fecha.

O `dispatchAlert` é criado uma vez, no nível do módulo: o limite de 10 min sobrevive a
parar e reiniciar o monitoramento pelo menu.

`ExitPromptError` (Ctrl+C num prompt) é tratado como "voltar/sair", não como erro.

### Ciclo de vida do WhatsApp

Não há cliente de WhatsApp persistente: **toda operação é `connect → ação → destroy`**
(`withWhatsApp`). Uma janela sobe só durante o envio e fecha em seguida. O que garante
1 aba por vez e execuções independentes é o `sanitizeBrowserProfile()` que roda em todo
`createWhatsAppClient` (ver abaixo) — não um cliente compartilhado.

## `src/monitor.js`

Exporta **`runMonitor({ once, signal, report, onAlert })`**. Sem efeito colateral na
importação; execução direta (`node src/monitor.js [--once]`) fica atrás de um guard
`import.meta.url === pathToFileURL(process.argv[1])`, que também liga `SIGINT`/`SIGTERM`
a um `AbortController`.

1. **Loop externo** (`while (!signal?.aborted)`): abre um Chromium novo, faz login e
   entra no loop interno. Se o navegador cair, espera 5s e reabre. `once` desliga a
   repetição; `signal` abortado encerra o loop de forma limpa.
2. **`login(page, report)`**: navega até o portal, espera o iframe liberar o formulário
   (`waitForLoginContext`, até 90s varrendo `page.frames()`), preenche `#logEmail` /
   `#logPassword`, clica em `#btnLogin`.
3. **Loop interno** (`do ... while (!once && !signal?.aborted)`): a cada 60s
   (`INTERVAL_MS`, via `sleep` abortável) chama `openNewStay` + `checkAvailability`.
4. **`openNewStay(page, report)`**: recarrega a tela de reservas (o portal só libera os
   recursos após reload), procura o link "Nova hospedagem". Se o portal voltar a pedir
   login, lança `SESSÃO EXPIRADA:` e o loop interno quebra para reautenticar.
5. **`checkAvailability(page, report)`**: lê o texto de todos os frames. `Nenhum mês
   aberto` → `VAGA NÃO DISPONÍVEL` (retorna `'unavailable'`). Qualquer outra resposta →
   `FALLBACK: RESPOSTA INESPERADA` (retorna `'unknown'`; nunca afirma que há vaga).
   Quando a regra positiva existir, deve retornar `'available'`.
6. **Despacho de alerta**: `'available'` → `report('VAGA DISPONÍVEL')` + `onAlert({ kind:
   'available' })`; `'unknown'` → `onAlert({ kind: 'fallback' })`. Falhas de processo
   (`FALLBACK: FALHA NO PROCESSO`, `SESSÃO EXPIRADA`, `FALLBACK: CHROMIUM`) **não**
   alertam — são infra e o loop já se recupera.

### Decisões de projeto

- **Conservadorismo na detecção.** Só o caso negativo é conhecido. Toda incerteza vira
  `FALLBACK` para não acordar ninguém à toa. A regra positiva deve ser adicionada só
  quando o elemento/texto de vaga estiver identificado com segurança.
- **Esperas por deadline, não por seletor único.** O portal é lento e usa iframes
  aninhados; o código faz polling com `isVisible().catch(() => false)` e prazos amplos.
- **Reinício resiliente.** Falhas de navegador reabrem o Chromium; falhas de sessão
  refazem o login; erros de página só são logados.

## `src/alerts.js`

**`createAlertDispatcher({ cooldownMs, now, onStatus, send })`** → a função `onAlert`.

- Rate-limit: **1 alerta a cada `cooldownMs` (padrão 10 min)**, somando `'available'` e
  `'fallback'`. Alertas na janela de silêncio são só logados (`ALERTA — <kind>:
  suprimido…`).
- A janela começa na **tentativa**, não no sucesso: se o envio falhar (WhatsApp fora),
  não fica reconectando a cada ciclo de 60s — espera o cooldown.
- `send` padrão = `withWhatsApp(c => sendWhatsAppAlert(c, msg))`. `now` e `send` são
  injetáveis; o teste em `docs`/scripts cobre o limite sem abrir navegador.
- Mensagens em `ALERT_MESSAGES` (`available` / `fallback`).

## `src/whatsapp-client.js`

Módulo reutilizável, sem efeitos colaterais na importação.

- **`createWhatsAppClient({ onStatus })`** → `{ client, ready }`.
  - `client`: instância `whatsapp-web.js` com `LocalAuth` (clientId `sesc-bertioga-bot`,
    sessão em `.wwebjs_auth/`).
  - `ready`: `Promise` que resolve quando o evento `ready` chega **e** o número
    conectado bate com `WHATSAPP_SENDER`; rejeita em `auth_failure` ou número divergente.
  - Eventos tratados: `qr` (imprime o QR Code no terminal), `authenticated`, `ready`.
  - Antes de subir o navegador, roda `sanitizeBrowserProfile()`: mata um Chromium órfão
    que tenha ficado segurando o lock do perfil (`SingletonLock`, confirmando pelo
    `/proc/<pid>/cmdline` que é o nosso), remove `Singleton*` e os arquivos de
    restauração de abas (`Sessions/`, `Current/Last Session`, `Current/Last Tabs`) e
    marca o perfil como encerrado corretamente. Assim cada execução começa com o
    navegador limpo — **só a sessão do WhatsApp** (IndexedDB/Local Storage) persiste.
- **`connectWhatsApp({ onStatus })`** → `client` já conectado (`initialize()` + `ready`);
  destrói sozinho se o `ready` falhar. Ao ficar pronto, `closeStrayPages` fecha qualquer
  aba que não seja a do WhatsApp Web. O chamador cuida do `client.destroy()`.
- **`withWhatsApp(fn, { onStatus })`**: `connectWhatsApp` → `fn(client)` → `client.destroy()`
  no `finally`. É o padrão de uso — a janela sobe só durante a operação. Retorna o que
  `fn` retornar.
- **`whatsAppSessionExists()`** → `boolean`; há `.wwebjs_auth/session-sesc-bertioga-bot/`?
- **`clearWhatsAppSessionFiles()`**: remove `.wwebjs_auth/` e `.wwebjs_cache/`.
- **`logoutWhatsApp({ onStatus })`**: conecta, chama `client.logout()` (desvincula o
  aparelho no celular) e no `finally` destrói o cliente + `clearWhatsAppSessionFiles()`.
  Falha no desvínculo remoto → só a sessão local é apagada.
- **`sendWhatsAppAlert(client, message, { onStatus })`**: lê `WHATSAPP_RECIPIENTS`
  (array JSON), normaliza cada número (`\D` removido, 10–15 dígitos) e envia para
  `<numero>@c.us`. Depois de cada `sendMessage`, aguarda o ACK do servidor via evento
  `message_ack` (até `WHATSAPP_ACK_TIMEOUT_MS`, padrão 30s; timeout só emite `AVISO`).
  Ao final, pausa `WHATSAPP_SETTLE_MS` (padrão 3s) antes de retornar, para o Chromium
  sincronizar antes de o chamador encerrar o cliente. Retorna a lista de destinatários.

## `src/whatsapp-test.js`

Script de fumaça. `withWhatsApp` → `sendWhatsAppAlert` (mensagem fixa). Equivale à opção
"Testar envio" da CLI, para quem prefere linha de comando. **Não rode junto com a CLI** —
o segundo processo mata o Chromium do primeiro (via `SingletonLock`) para assumir o perfil.

## `src/logger.js`

`timestamp()` (fuso `America/Sao_Paulo`, `sv-SE` → ISO-like) e
`report(status, details)` — o formato de log usado por todos os módulos.

## Persistência

| Diretório | Conteúdo | Versionado? |
| --- | --- | --- |
| `.wwebjs_auth/session-sesc-bertioga-bot/` | Perfil Chromium + sessão autenticada do WhatsApp Web | Não (`.gitignore`) |
| `.wwebjs_cache/` | HTML do WhatsApp Web em cache | Não (`.gitignore`) |

Do perfil Chromium, **só a autenticação do WhatsApp** é tratada como estado durável;
abas, janelas e locks são zerados a cada execução (`sanitizeBrowserProfile`). Não há
banco de dados nem estado em disco do lado do monitor do portal — cada ciclo é
independente.

## Pontos de extensão

- **Regra positiva de vaga**: fazer `checkAvailability` retornar `'available'` a partir
  de um seletor/texto específico, com testes manuais documentados. O resto do caminho
  (`onAlert` → `alerts.js` → `sendWhatsAppAlert`) já está ligado e com rate-limit.
- **Rate-limit por tipo**: hoje o limite de 10 min é único. Poderia ser separado
  (vaga imediata, fallback mais espaçado) se o fallback ficar barulhento.
- **Observabilidade**: hoje é só `console.log`. Um arquivo de log rotacionado ou um
  webhook ajudaria a auditar execuções longas.
