# Como contribuir

Projeto pessoal e pequeno. As notas abaixo valem tanto para quem for mexer manualmente
quanto para agentes.

## Ambiente

```bash
npm install
npx playwright install chromium
cp .env.example .env   # preencha as credenciais
```

Node.js >= 20 (desenvolvido no v24). Projeto em ESM puro (`"type": "module"`) — use
`import`, não `require`.

## Rodando

- `npm start` — CLI com menu. Entrypoint normal; orquestra monitor + WhatsApp.
- `npm run login` — uma consulta ao portal, Chromium visível. Melhor forma de depurar
  o fluxo do portal.
- `npm run monitor` — loop de 60s.
- `npm run whatsapp:test` — valida a conexão do WhatsApp.

Não há testes automatizados. Toda mudança que toca o portal ou o WhatsApp precisa ser
verificada rodando os scripts acima e conferindo a saída.

## Estilo

- Mensagens de usuário, logs e comentários **em português**.
- Status em CAIXA ALTA via `report(status, details)` de `src/logger.js`.
- Timestamps sempre no fuso `America/Sao_Paulo`.
- Configuração via `process.env`; falhe cedo e com mensagem clara quando faltar algo
  obrigatório.
- Ao esperar por elementos do portal, use polling com deadline (como o código já faz),
  não `waitForSelector` único — o portal é lento e cheio de iframes.

## Regra de ouro: nada de falso positivo

`checkAvailability` só afirma o que tem certeza (`VAGA NÃO DISPONÍVEL`). Toda dúvida vira
`FALLBACK`. Só adicione uma detecção positiva de vaga quando o texto/elemento estiver
confirmado observando o portal com vaga real. Um alerta errado acorda pessoas de
madrugada — prefira errar para o lado silencioso.

## Segredos

Nunca commite `.env`, `.wwebjs_auth/` ou `.wwebjs_cache/`. Não cole o conteúdo deles em
commits, issues ou logs.

## Git

O repositório ainda não foi inicializado. Ao fazer isso:

```bash
git init
git add .
git status   # confirme que .env NÃO aparece
```
