// Log padrão do projeto: timestamp no fuso America/Sao_Paulo (formato ISO-like)
// seguido de um status em CAIXA ALTA e detalhes opcionais.

const timeFormat = new Intl.DateTimeFormat('sv-SE', {
  dateStyle: 'short', timeStyle: 'medium', timeZone: 'America/Sao_Paulo',
});

export function timestamp() {
  return timeFormat.format(new Date()).replace(' ', 'T');
}

export function report(status, details = '') {
  console.log(`${timestamp()} ${status}${details ? ` — ${details}` : ''}`);
}
