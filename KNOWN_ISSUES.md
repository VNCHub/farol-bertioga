# Limitações e pendências conhecidas

## Bloqueadores de funcionalidade

- **Não existe regra positiva de "há vaga".** `checkAvailability` só reconhece o texto
  `Nenhum mês aberto` (retorna `'unavailable'`); qualquer outra resposta vira
  `'unknown'` + `FALLBACK: RESPOSTA INESPERADA`. Falta observar o portal com vaga aberta
  para identificar o texto/elemento e fazer a função retornar `'available'`. O caminho
  de alerta (`onAlert` → `alerts.js` → `sendWhatsAppAlert`) já está ligado; hoje só o
  `'fallback'` chega a disparar.
- **O alerta de fallback é ambíguo por natureza.** `'unknown'` cobre tanto "o portal
  mudou / quebrou o seletor" quanto "pode ter vaga". O rate-limit de 10 min segura o
  volume, mas o texto pede confirmação manual.
- **Rate-limit não persiste entre execuções da CLI.** É estado em memória do processo;
  reabrir a CLI zera a janela de 10 min.

## Robustez

- **Seletores acoplados ao HTML do portal** (`#logEmail`, `#logPassword`, `#btnLogin`,
  texto "Nova hospedagem", "Nenhum mês aberto"). Qualquer mudança no portal quebra o
  fluxo silenciosamente (cai em `FALLBACK`).
- **Sessão do portal expira** e o código apenas reautentica no próximo ciclo; não há
  aviso de que ficou tempo sem monitorar de fato.
- **`fillFirst` ainda aceita uma lista de seletores**, mas as chamadas passam sempre um
  único seletor — sobra de uma versão anterior.
- **Cada alerta paga o custo de reconectar o WhatsApp** (~10–15s: sobe o Chromium,
  espera `ready`, envia, fecha). Aceitável para um evento raro; se os alertas ficarem
  frequentes, valeria um cliente vivo durante o monitoramento.
- **Só um processo por vez pode falar com o WhatsApp.** `npm run whatsapp:test` e a CLI
  disputam o mesmo perfil `.wwebjs_auth/`. Rodar os dois **ao mesmo tempo**: o segundo
  mata o Chromium do primeiro (via `SingletonLock`) para assumir o perfil.
- **`sanitizeBrowserProfile` supõe o layout de perfil do Chromium/Chrome** (`Default/`,
  `SingletonLock` como symlink `host-pid`, `/proc/<pid>/cmdline`). É Linux-first; em
  outro SO a limpeza de lock vira no-op silencioso.

## Operação

- **Sem testes, lint ou CI.** Toda verificação é manual.
- **Sem persistência de histórico.** Não dá para saber depois quando o monitor rodou
  ou o que viu, além do que ficou no terminal.
- **Roda em processo único no terminal.** Não há supervisão (systemd, pm2, container);
  se o processo morrer, ninguém reinicia.
- **Não é um repositório Git ainda.** Rode `git init` antes de versionar e confirme que
  o `.env` está ignorado.

## Ideias de evolução

- Integrar os canais com deduplicação por janela de tempo.
- Registrar execuções em arquivo de log rotacionado.
- Parametrizar `PORTAL_URL`, `INTERVAL_MS` e textos via `.env`.
- Empacotar para rodar como serviço.
