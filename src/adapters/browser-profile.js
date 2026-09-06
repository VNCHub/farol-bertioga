// Higienização do perfil Chromium usado pelo WhatsApp Web.
//
// O whatsapp-web.js (via LocalAuth) reaproveita um perfil de navegador inteiro
// entre execuções. Guardar o estado de restauração de abas/janelas faz o Chromium
// reabrir abas antigas (e acumular mais a cada vez); um lock órfão de uma execução
// que morreu mal impede a próxima de abrir. Este módulo zera esse estado antes de
// cada conexão — os dados de login do WhatsApp vivem em IndexedDB/Local Storage e
// NÃO são tocados aqui, então cada execução começa limpa com a sessão intacta.

import { existsSync, readFileSync, readlinkSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  WHATSAPP_AUTH_DIR as AUTH_DIR,
  WHATSAPP_CLIENT_ID as CLIENT_ID,
  WHATSAPP_PROFILE_DIR as PROFILE_DIR,
} from '../config.js';

const TAB_STATE_ENTRIES = ['Sessions', 'Current Session', 'Current Tabs', 'Last Session', 'Last Tabs'];
const LOCK_ENTRIES = ['SingletonLock', 'SingletonCookie', 'SingletonSocket'];

// Se uma execução anterior morreu sem fechar o Chromium, ele fica órfão segurando
// o lock do perfil — e a próxima abertura falha ("browser is already running") ou
// vem em branco. Aqui matamos esse Chromium órfão (confirmando que é o nosso pelo
// cmdline) e removemos o lock.
function releaseProfileLock(onStatus) {
  const lockPath = join(AUTH_DIR, 'SingletonLock');
  let pid;
  try {
    pid = Number(readlinkSync(lockPath).split('-').pop());
  } catch {
    pid = undefined; // não é symlink ou não existe
  }

  if (Number.isInteger(pid) && pid > 0) {
    let cmdline = '';
    try {
      cmdline = readFileSync(`/proc/${pid}/cmdline`, 'utf8');
    } catch {
      cmdline = ''; // processo já não existe → lock órfão
    }
    if (cmdline.includes(`session-${CLIENT_ID}`)) {
      try {
        process.kill(pid, 'SIGKILL');
        onStatus?.(`Chromium órfão (pid ${pid}) encerrado.`);
      } catch {
        // sem permissão ou já morreu
      }
    }
  }

  for (const name of LOCK_ENTRIES) {
    rmSync(join(AUTH_DIR, name), { force: true });
  }
}

export function sanitizeBrowserProfile(onStatus) {
  if (!existsSync(AUTH_DIR)) return;

  releaseProfileLock(onStatus);

  for (const entry of TAB_STATE_ENTRIES) {
    rmSync(join(PROFILE_DIR, entry), { recursive: true, force: true });
    rmSync(join(AUTH_DIR, entry), { recursive: true, force: true });
  }

  // Marca o perfil como encerrado corretamente — sem isso o Chromium acha que
  // travou e restaura as abas da sessão anterior. (São campos de estado, não
  // preferências protegidas: editar aqui não dispara aviso de adulteração.)
  const prefsPath = join(PROFILE_DIR, 'Preferences');
  try {
    const prefs = JSON.parse(readFileSync(prefsPath, 'utf8'));
    prefs.profile = { ...prefs.profile, exit_type: 'Normal', exited_cleanly: true };
    if (prefs.sessions) prefs.sessions.event_log = [];
    writeFileSync(prefsPath, JSON.stringify(prefs));
  } catch {
    // Primeira execução (sem Preferences ainda) — nada a fazer.
  }
}

// Fecha qualquer aba que não seja a do WhatsApp Web.
export async function closeStrayPages(client) {
  const browser = client.pupBrowser;
  const keep = client.pupPage;
  if (!browser || !keep) return;
  const pages = await browser.pages().catch(() => []);
  await Promise.all(
    pages.filter((page) => page !== keep).map((page) => page.close().catch(() => {})),
  );
}
