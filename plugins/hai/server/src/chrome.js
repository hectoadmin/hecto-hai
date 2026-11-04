/**
 * 평소 쓰는 크롬을 켜고 주소를 연다(연동 3단계). 디버깅 포트 없이 그냥 실행 — 평소 프로필이라 로그인·확장이 그대로다.
 * 화면 조작은 확장이 하고 여기서는 켜기만 한다. 셸을 거치지 않고, http(s) 주소만 넘긴다(인자로 끼어들지 못하게).
 */
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { HaiError } from './hai.js';

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

/** 실행할 명령 (순수 함수) → {cmd, args}. 크롬을 못 찾으면 HaiError */
export function chromeCommand(urls, { platform = process.platform, env = process.env, exists = existsSync } = {}) {
  if (platform === 'darwin') return { cmd: 'open', args: ['-g', '-a', 'Google Chrome', ...urls] };   // -g: 지금 쓰는 창을 가리지 않는다
  if (platform === 'win32') {
    const roots = [env.PROGRAMFILES, env['PROGRAMFILES(X86)'], env.LOCALAPPDATA].filter(Boolean);
    const exe = roots.map((r) => path.win32.join(r, 'Google', 'Chrome', 'Application', 'chrome.exe')).find((p) => exists(p));
    if (!exe) throw new HaiError('CHROME_NOT_FOUND', '크롬을 찾지 못했습니다. 크롬을 직접 켜 주세요.');
    return { cmd: exe, args: urls };
  }
  return { cmd: 'google-chrome', args: urls };
}

/** 크롬을 켠다(이미 켜져 있으면 주소만 새 탭으로) */
export async function openChrome(urls = [], { run = spawn } = {}) {
  const { cmd, args } = chromeCommand(urls.map(siteUrl));
  await new Promise((ok, no) => {
    const p = run(cmd, args, { detached: true, stdio: 'ignore' });
    p.once('error', () => no(new HaiError('CHROME_NOT_FOUND', '크롬을 켜지 못했습니다. 크롬을 직접 켜 주세요.')));
    p.once('spawn', ok);
    p.unref();
  });
}
