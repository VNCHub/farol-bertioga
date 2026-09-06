# Monitor de reservas — Sesc Bertioga

Monitor não oficial de disponibilidade de reservas do **Centro de Férias Sesc Bertioga**.
O portal oficial não avisa quando abrem vagas; este projeto automatiza o navegador para
consultar o portal a cada minuto e, futuramente, alertar por WhatsApp um grupo pequeno
de contatos.

> ⚠️ Projeto pessoal, sem vínculo com o Sesc. Use com as suas próprias credenciais e
> respeite os termos de uso do portal.

## Requisitos

- Node.js >= 20 (testado no v24)
- Chromium do Playwright (instalado por comando, abaixo)

## Instalação

```bash
npm install
npx playwright install chromium
```

## Configuração

Copie `.env.example` para `.env` e preencha:

| Variável | Descrição |
| --- | --- |
| `LOGIN` | E-mail/usuário do portal de reservas |
| `SENHA` | Senha do portal |
| `HEADLESS` | `false` (padrão) mostra o Chromium; `true` roda oculto |
| `WHATSAPP_SENDER` | Número que envia os alertas (só dígitos, com DDI). Conectado por QR Code |
| `WHATSAPP_RECIPIENTS` | Array JSON de números que recebem alertas, ex.: `["5511999999999"]` |
| `WHATSAPP_HEADLESS` | `false` (padrão) abre o WhatsApp Web no Chromium com o QR Code visível |

O `.env` real é ignorado pelo Git. Detalhes em [`docs/CONFIGURACAO.md`](docs/CONFIGURACAO.md).

## Uso

```bash
npm start   # CLI com menu interativo — a forma normal de usar
```

O menu cobre:

- **Iniciar monitoramento** — com ou sem alertas por WhatsApp (Ctrl+C volta ao menu).
  No modo com alertas, uma mensagem é enviada quando o portal mostra uma vaga **ou**
  responde de forma inesperada, no máximo **1 a cada 10 minutos**.
- **Gerenciar notificações WhatsApp** — login (QR Code) / logout e teste de envio.

> A detecção positiva de vaga ainda não está definida (`checkAvailability` nunca afirma
> "há vaga"). Na prática, hoje o alerta que dispara é o de **resposta inesperada** —
> um lembrete para conferir o portal manualmente. Ver `KNOWN_ISSUES.md`.

### Scripts diretos (sem menu)

```bash
npm run login          # uma consulta única, com o Chromium visível
npm run monitor        # repete a consulta a cada minuto (Ctrl+C para parar)
npm run whatsapp:test  # conecta o WhatsApp e envia uma mensagem de teste
```

### Como ler a saída

O monitor imprime linhas com timestamp (fuso de São Paulo) e um status em CAIXA ALTA:

- `VAGA NÃO DISPONÍVEL` — o portal mostrou `Nenhum mês aberto`.
- `FALLBACK: ...` — qualquer resposta inesperada ou falha controlada. **Não é** um
  sinal de vaga; existe para evitar falso positivo enquanto a regra de identificação
  positiva de vaga não estiver definida.

## Documentação

- [`docs/ARQUITETURA.md`](docs/ARQUITETURA.md) — como as peças se encaixam
- [`docs/CONFIGURACAO.md`](docs/CONFIGURACAO.md) — variáveis de ambiente e sessões
- [`KNOWN_ISSUES.md`](KNOWN_ISSUES.md) — limitações e pendências
- [`CONTRIBUTING.md`](CONTRIBUTING.md) — como mexer no código

## Licença

[MIT](LICENSE)
