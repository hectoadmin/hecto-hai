/**
 * 평소 쓰는 크롬을 켜고 주소를 연다(연동 3단계). 디버깅 포트 없이 그냥 실행 — 평소 프로필이라 로그인·확장이 그대로다.
 * 화면 조작은 확장이 하고 여기서는 켜기만 한다. 셸을 거치지 않고, http(s) 주소만 넘긴다(인자로 끼어들지 못하게).
 * 예외는 확장 프로그램 화면(chrome://extensions) 하나 — 받은 값이 아니라 여기 적어 둔 주소다(agent_install).
 * 시스템 기본 브라우저가 엣지면 크롬 대신 엣지를 쓴다(pickBrowser) — 확장은 엣지에도 같은 폴더로 올라간다.
 */
import { execFileSync, spawn } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { HaiError } from './hai.js';

/** 확장을 올릴 수 있는 브라우저. eul·i: "…을/를"·"…이/가" 붙인 이름, profiles: 프로필 폴더들이 든 곳(Windows 는 LOCALAPPDATA, 그 밖은 홈 아래) */
export const BROWSERS = {
  chrome: {
    id: 'chrome', name: '크롬', eul: '크롬을', i: '크롬이', app: 'Google Chrome', win: ['Google', 'Chrome', 'Application', 'chrome.exe'], bin: 'google-chrome', extensions: 'chrome://extensions',
    profiles: { darwin: ['Library', 'Application Support', 'Google', 'Chrome'], win32: ['Google', 'Chrome', 'User Data'], linux: ['.config', 'google-chrome'] },
  },
  edge: {
    id: 'edge', name: '엣지', eul: '엣지를', i: '엣지가', app: 'Microsoft Edge', win: ['Microsoft', 'Edge', 'Application', 'msedge.exe'], bin: 'microsoft-edge', extensions: 'edge://extensions',
    profiles: { darwin: ['Library', 'Application Support', 'Microsoft Edge'], win32: ['Microsoft', 'Edge', 'User Data'], linux: ['.config', 'microsoft-edge'] },
  },
};

/** 확장 ID — manifest key 로 고정이라 어느 PC·어느 브라우저에 올려도 같다 */
export const EXTENSION_ID = 'emfajicbilaefeelnkgpndhhakpakfmc';

/** 자주 여는 곳 — 이름으로 부를 수 있게 */
export const SITES = {
  메일: 'https://mail.worksmobile.com/',
  메신저: 'https://talk.worksmobile.com/',
  캘린더: 'https://calendar.worksmobile.com/',
  그룹웨어: 'https://gw.hecto.co.kr/',
};
const ALIAS = { 메시지: '메신저', 웍스: '메신저', 일정: '캘린더', 달력: '캘린더', gw: '그룹웨어' };

/** 이름(메일·메신저·캘린더·그룹웨어) 또는 http(s) 주소 → 주소 */
export function siteUrl(site) {
  const s = String(site ?? '').trim();
  const known = SITES[ALIAS[s.toLowerCase()] ?? s];
  if (known) return known;
  let u = null;
  try { u = new URL(s); } catch { /* 아래에서 거절 */ }
  if (!u || !/^https?:$/.test(u.protocol)) throw new HaiError('SITE_INVALID', `'${s}' 는 열 수 없습니다. ${Object.keys(SITES).join('·')} 또는 http(s) 주소를 주세요.`);
  return u.href;
}

/** Windows 에 깔린 실행 파일 경로(없으면 undefined) */
function winExe(browser, { env = process.env, exists = existsSync } = {}) {
  const roots = [env.PROGRAMFILES, env['PROGRAMFILES(X86)'], env.LOCALAPPDATA].filter(Boolean);
  return roots.map((r) => path.win32.join(r, ...browser.win)).find((p) => exists(p));
}

/** 실행할 명령 (순수 함수) → {cmd, args}. 브라우저를 못 찾으면 HaiError. browser 를 안 주면 크롬 */
export function chromeCommand(urls, { platform = process.platform, env = process.env, exists = existsSync, front = false, browser = BROWSERS.chrome } = {}) {
  if (platform === 'darwin') return { cmd: 'open', args: [...(front ? [] : ['-g']), '-a', browser.app, ...urls] };   // -g: 지금 쓰는 창을 가리지 않는다
  if (platform === 'win32') {
    const exe = winExe(browser, { env, exists });
    if (!exe) throw new HaiError('CHROME_NOT_FOUND', `${browser.eul} 찾지 못했습니다. ${browser.eul} 직접 켜 주세요.`);
    return { cmd: exe, args: urls };
  }
  return { cmd: browser.bin, args: urls };
}

/** Windows `reg query …\UrlAssociations\https /s /v ProgId` 출력 → 기본 브라우저 ProgId (순수 함수). 새 Windows 는 UserChoiceLatest 가 먼저다 */
export function winProgId(out) {
  const found = {};
  let key = '';
  for (const line of String(out ?? '').split(/\r?\n/)) {
    if (/^HKEY_/i.test(line.trim())) key = line.trim();
    const m = /^\s*ProgId\s+REG_SZ\s+(\S+)/i.exec(line);
    if (m) found[/UserChoiceLatest/i.test(key) ? 'latest' : 'choice'] = m[1];
  }
  return found.latest ?? found.choice ?? null;
}

const QUIET = { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], windowsHide: true, timeout: 10_000 };
const WIN_HTTPS_KEY = 'HKCU\\Software\\Microsoft\\Windows\\Shell\\Associations\\UrlAssociations\\https';

/** 시스템 기본 브라우저 → 'edge' | 'chrome'. 엣지(정식판)일 때만 'edge' — 그 밖(사파리·웨일·알 수 없음)은 전처럼 크롬 */
export function defaultBrowser({ platform = process.platform, exec = execFileSync, home = os.homedir(), env = process.env } = {}) {
  try {
    if (platform === 'win32') {
      const reg = path.win32.join(env.SystemRoot ?? env.SYSTEMROOT ?? 'C:\\Windows', 'System32', 'reg.exe');   // 이름만 주면 지금 폴더의 같은 이름 파일이 먼저 잡힌다
      return /^MSEdgeHTM$/i.test(winProgId(exec(reg, ['query', WIN_HTTPS_KEY, '/s', '/v', 'ProgId'], QUIET)) ?? '') ? 'edge' : 'chrome';
    }
    if (platform === 'darwin') {
      const plist = path.join(home, 'Library', 'Preferences', 'com.apple.LaunchServices', 'com.apple.launchservices.secure.plist');
      const handlers = JSON.parse(exec('plutil', ['-extract', 'LSHandlers', 'json', '-o', '-', plist], QUIET));
      const https = handlers.find((h) => h.LSHandlerURLScheme === 'https');
      return /^com\.microsoft\.edgemac$/i.test(https?.LSHandlerRoleAll ?? '') ? 'edge' : 'chrome';
    }
    return /^microsoft-edge\.desktop$/i.test(String(exec('xdg-settings', ['get', 'default-web-browser'], QUIET)).trim()) ? 'edge' : 'chrome';
  } catch { return 'chrome'; }
}

/** 그 브라우저의 어느 프로필에든 헥토 에이전트 확장이 올라가 있나 — 프로필 설정 파일의 확장 목록(extensions.settings)에 확장 ID 가 있는지만 본다(지운 뒤 다른 곳에 남은 흔적은 세지 않는다) */
export function hasExtension(browser, { platform = process.platform, env = process.env, home = os.homedir(), readdir = readdirSync, read = readFileSync } = {}) {
  const base = platform === 'win32' ? env.LOCALAPPDATA : home;
  if (!base) return false;
  const join = platform === 'win32' ? path.win32.join : path.join;
  const root = join(base, ...(browser.profiles[platform] ?? browser.profiles.linux));
  let dirs = [];
  try { dirs = readdir(root).filter((d) => /^(Default|Profile \d+)$/.test(d)); } catch { return false; }
  return dirs.some((d) => ['Secure Preferences', 'Preferences'].some((f) => {
    try { return Boolean(JSON.parse(read(join(root, d, f), 'utf8'))?.extensions?.settings?.[EXTENSION_ID]); } catch { return false; }
  }));
}

/**
 * 쓸 브라우저를 고른다 → BROWSERS 의 하나.
 *   기본 브라우저가 엣지면 엣지. 다만 확장이 크롬에만 올라가 있으면(기본은 엣지인데 크롬에 깔아 쓰던 사람) 전처럼 크롬.
 *   Windows 에서 고른 쪽이 안 깔려 있고 다른 쪽은 깔려 있으면 깔려 있는 쪽.
 */
export function pickBrowser({ platform = process.platform, def = defaultBrowser, has = hasExtension, installed = (b) => platform !== 'win32' || Boolean(winExe(b)) } = {}) {
  const { chrome, edge } = BROWSERS;
  let want = chrome;
  if (def({ platform }) === 'edge') want = has(chrome, { platform }) && !has(edge, { platform }) ? chrome : edge;
  const other = want === chrome ? edge : chrome;
  return !installed(want) && installed(other) ? other : want;
}

/** 브라우저를 켠다(이미 켜져 있으면 주소만 새 탭으로) → 켠 브라우저 */
export const openChrome = async (urls = [], opts) => launch(urls.map(siteUrl), opts);

/** 확장 프로그램 화면을 연다 — 확장을 올릴 때 사람이 개발자 모드를 켜고 폴더를 고르는 곳. 설치하려는 것이라 앞으로 띄운다 → 연 브라우저 */
export const openExtensionsPage = ({ browser = pickBrowser(), ...opts } = {}) => launch([browser.extensions], { ...opts, browser, front: true });

async function launch(urls, { run = spawn, front = false, browser = pickBrowser() } = {}) {
  const { cmd, args } = chromeCommand(urls, { front, browser });
  await new Promise((ok, no) => {
    const p = run(cmd, args, { detached: true, stdio: 'ignore' });
    p.once('error', () => no(new HaiError('CHROME_NOT_FOUND', `${browser.eul} 켜지 못했습니다. ${browser.eul} 직접 켜 주세요.`)));
    p.once('spawn', ok);
    p.unref();
  });
  return browser;
}
