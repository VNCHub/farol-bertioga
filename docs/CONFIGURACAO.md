# Configuração

Toda a configuração vem de variáveis de ambiente, carregadas de `.env` via
`import 'dotenv/config'`. Comece copiando o modelo:

```bash
cp .env.example .env
```

## Variáveis

### Portal de reservas (`src/monitor.js`)

| Variável | Obrigatória | Padrão | Descrição |
| --- | --- | --- | --- |
| `LOGIN` | sim | — | E-mail/usuário do portal `centrodeferias.sescsp.org.br`. Sem ela o monitor lança erro na inicialização. |
| `SENHA` | sim | — | Senha do portal. |
| `HEADLESS` | não | `false` | Qualquer valor diferente de `true` abre o Chromium visível com `slowMo` de 250ms. `true` roda oculto e sem `slowMo`. |

### WhatsApp (`src/whatsapp-client.js`, `src/whatsapp-test.js`)

| Variável | Obrigatória | Padrão | Descrição |
| --- | --- | --- | --- |
| `WHATSAPP_SENDER` | sim (para o fluxo de WhatsApp) | — | Número que **envia** os alertas, só dígitos, com DDI (Brasil: `55`). É o número que você conecta pelo QR Code. O cliente recusa a conexão se o número autenticado não bater com este. |
| `WHATSAPP_RECIPIENTS` | sim (para o fluxo de WhatsApp) | `[]` | Array JSON de números que **recebem** alertas, ex.: `["5511988887777","5513997776666"]`. Lista vazia é erro. Cada número é normalizado (só dígitos) e precisa ter 10–15 dígitos. |
| `WHATSAPP_HEADLESS` | não | `false` | `true` roda o WhatsApp Web oculto e imprime o QR Code em ASCII no terminal. Qualquer outro valor abre o Chromium com o QR Code na tela. |
| `WHATSAPP_ACK_TIMEOUT_MS` | não | `30000` | Tempo máximo, em ms, que `sendWhatsAppAlert` aguarda a confirmação de recebimento do servidor (ACK) de cada mensagem. Ao estourar, registra `AVISO` e segue. |
| `WHATSAPP_SETTLE_MS` | não | `3000` | Pausa, em ms, após enviar todas as mensagens e antes de devolver o controle, para o Chromium terminar de sincronizar com o WhatsApp Web antes de o cliente ser encerrado. |

### Formato dos números

- Apenas dígitos: `5511999998888` (DDI 55 + DDD 11 + número).
- Sem `+`, espaços, parênteses ou traços — são removidos, mas evite.
- Validação: 10 a 15 dígitos após a limpeza.

## Sessões persistidas

O primeiro `npm run whatsapp:test` pede o QR Code. Depois disso a sessão fica em
`.wwebjs_auth/session-sesc-bertioga-bot/` e os próximos comandos reconectam sozinhos.

Para **forçar novo pareamento** (trocar de número, sessão corrompida):

```bash
rm -rf .wwebjs_auth .wwebjs_cache
npm run whatsapp:test
```

## Segurança

- `.env`, `.wwebjs_auth/` e `.wwebjs_cache/` estão no `.gitignore`. Mantêm credenciais
  e uma sessão de WhatsApp autenticada — tratar como segredo.
- Nunca cole o conteúdo desses arquivos em issues, logs ou chats.
- Se o repositório for para um remoto público, confirme antes que o histórico do Git
  nunca conteve o `.env`.
