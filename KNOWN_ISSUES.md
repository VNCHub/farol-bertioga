# Limitações e pendências conhecidas

## Bloqueadores de funcionalidade

- **Regra positiva de vaga é indireta.** `checkAvailability` agora reconhece três
  cenários: `Nenhum mês aberto` → `'unavailable'`; mês listado em "Meses disponíveis"
  cujo passo "Períodos" mostra `Disponíveis (0)` / `Não há períodos disponíveis` →
  `'sem-periodo'` (só loga `MÊS SEM PERÍODO`, não alerta); mês com `Disponíveis (N ≥ 1)`
  → `'available'` (alerta WhatsApp nomeando o mês). Ainda **não** foi possível observar
  o portal com uma vaga real (`N ≥ 1`) — a leitura da contagem é a melhor hipótese e
  pode precisar de ajuste quando isso acontecer; `parsePeriodCount` é onde mexer.
- **O alerta de fallback continua ambíguo.** `'unknown'` cobre "o portal mudou / quebrou
  o seletor" e "meses listados mas sem contagem legível". O rate-limit de 10 min segura
  o volume, mas o texto pede confirmação manual.
- **`checkAvailability` clica mês a mês.** Para ler a contagem de períodos ele seleciona
  cada pill e espera o passo "Períodos" assentar. O custo por ciclo cresce com o número
  de meses abertos (hoje é sempre 0 ou 1).
- **Rate-limit não persiste entre execuções da CLI.** É estado em memória do processo;
  reabrir a CLI zera a janela de 10 min. Os meses de interesse escolhidos no menu
  também não persistem.

## Robustez

- **Seletores acoplados ao HTML do portal** (`#logEmail`, `#logPassword`, `#btnLogin`,
  `button[ng-click^="setPeriodo"]`, textos "Nova hospedagem", "Nenhum mês aberto",
  "Disponíveis (N)", "Não há períodos disponíveis"). Qualquer mudança no portal quebra o
  fluxo silenciosamente (cai em `FALLBACK`).
- **Login do portal é sensível a timing.** O formulário é AngularJS; se o clique no
  `#btnLogin` acontecer cedo demais, o portal faz um submit nativo (GET com a senha na
  URL) sem autenticar. `login()` pausa 1s antes de clicar e confere se o formulário
  sumiu, refazendo até 3× — mas continua sendo um ponto frágil.
- **Sessão do portal expira** e o código apenas reautentica no próximo ciclo; não há
  aviso de que ficou tempo sem monitorar de fato.
- **`fillFirst` (em `src/adapters/portal.js`) ainda aceita uma lista de seletores**, mas
  as chamadas passam sempre um único seletor — sobra de uma versão anterior.
- **Cada alerta paga o custo de reconectar o WhatsApp** (~10–15s: sobe o Chromium,
  espera `ready`, envia, fecha). Aceitável para um evento raro; se os alertas ficarem
  frequentes, valeria um cliente vivo durante o monitoramento.
- **Só um processo por vez pode falar com o WhatsApp.** `npm run whatsapp:test` e a CLI
  disputam o mesmo perfil `.wwebjs_auth/`. Rodar os dois **ao mesmo tempo**: o segundo
  mata o Chromium do primeiro (via `SingletonLock`) para assumir o perfil.
- **`adapters/browser-profile.js` supõe o layout de perfil do Chromium/Chrome** (`Default/`,
  `SingletonLock` como symlink `host-pid`, `/proc/<pid>/cmdline`). É Linux-first; em
  outro SO a limpeza de lock vira no-op silencioso.

## Operação

- **Cobertura de testes parcial.** `npm test` (Vitest) cobre `config.js`, `logger.js`,
  `services/notifier.js` e as funções puras de `adapters/portal.js`
  (`classifyAvailability`, `parsePeriodCount`),
  `adapters/whatsapp-client.js` (`waitForServerAck`) e `services/monitor.js` (`sleep`);
  CI roda no GitHub Actions. Ainda **sem teste** para o loop de `runMonitor` (precisa de
  mock do Playwright), a CLI (`cli.js`) e `adapters/browser-profile.js` (efeitos de
  sistema). Sem lint.
- **Sem persistência de histórico.** Não dá para saber depois quando o monitor rodou
  ou o que viu, além do que ficou no terminal.
- **Roda em processo único no terminal.** Não há supervisão (systemd, pm2, container);
  se o processo morrer, ninguém reinicia.

## Ideias de evolução

- Integrar os canais com deduplicação por janela de tempo.
- Registrar execuções em arquivo de log rotacionado.
- Parametrizar os textos do portal via `.env` (`PORTAL_URL`, `MONITOR_INTERVAL_MS` e
  `BROWSER_RESTART_MS` já saem de `src/config.js`).
- Empacotar para rodar como serviço.
