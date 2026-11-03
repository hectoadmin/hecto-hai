/**
 * hai 로그인 — 개인 HAI 키 대신 헥토 통합인증으로 로그인하고, agent 서버(agent.hecto.co.kr)가 사내 AI 를 대신 부른다.
 *   1) 127.0.0.1 의 빈 포트에 잠깐 서버를 열고, 브라우저로 {agent}/auth/hai/start?port=&state=&challenge= 를 연다
 *   2) 통합인증 로그인이 끝나면 서버가 http://127.0.0.1:<포트>/callback?code=&state= 로 돌려보낸다
 *   3) POST {agent}/auth/hai/token {code, verifier} → 토큰. 토큰은 이 PC 의 안전한 저장소에만 둔다
 *      macOS 키체인(서비스 hai-agent-token) · Windows 는 DPAPI(이 사용자만 풀 수 있게 암호화한 파일) · 그 밖은 0600 파일
 * 토큰은 기간 제한이 없다 — hai_logout · 통합인증 로그아웃·퇴사 · 운영자 차단 때 끊긴다.
 */
import { execFileSync, spawn } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { config } from './config.js';

// 키체인 항목을 -T 로 node 에만 허용하는 것은 쓰지 않는다 — 읽는 쪽이 node 가 아니라 /usr/bin/security(Claude 가 Bash 로 부를 수 있는 같은 프로그램)라
// 허용 목록으로 둘을 가를 수 없고, security 를 빼면 서버가 읽을 때마다 사용자에게 묻는다. Claude 쪽은 훅(hooks/guard.mjs)이 비밀값 꺼내는 명령을 막는다
const KEYCHAIN = 'hai-agent-token';
// HAI_TOKEN_STORE=file: 운영체제 저장소 대신 0600 파일(시험·리눅스용)
const store = () => (process.env.HAI_TOKEN_STORE === 'file' ? 'file' : os.platform());
const fileOf = () => path.join(config.dataDir, store() === 'win32' ? 'agent-token.dpapi' : 'agent-token');
const ps = (script, input) => execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script],
  { input, encoding: 'utf8', stdio: ['pipe', 'pipe', 'ignore'], windowsHide: true, timeout: 15_000 }).trim();

let cached;
/** 저장된 토큰(없으면 '') — 값은 이 모듈 밖에서 출력하지 않는다 */
export function loadToken() {
  if (cached !== undefined) return cached;
  let t = '';
  try {
    if (store() === 'darwin') {
      t = execFileSync('security', ['find-generic-password', '-s', KEYCHAIN, '-w'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    } else if (store() === 'win32') {
      if (fs.existsSync(fileOf())) {
        t = ps(`$s = Get-Content -Raw -LiteralPath '${fileOf().replace(/'/g, "''")}' | ConvertTo-SecureString; [Runtime.InteropServices.Marshal]::PtrToStringBSTR([Runtime.InteropServices.Marshal]::SecureStringToBSTR($s))`);
      }
    } else if (fs.existsSync(fileOf())) {
      t = fs.readFileSync(fileOf(), 'utf8').trim();
    }
  } catch { t = ''; }
  cached = /^[A-Za-z0-9_-]{20,200}$/.test(t) ? t : '';
  return cached;
}

export function saveToken(token) {
  if (!/^[A-Za-z0-9_-]{20,200}$/.test(String(token))) throw new Error('로그인 서버가 준 토큰 모양이 이상합니다. 다시 로그인하세요.');
  fs.mkdirSync(config.dataDir, { recursive: true, mode: 0o700 });
  if (store() === 'darwin') {
    // 토큰을 명령줄 인자에 싣지 않는다(ps 로 보인다) — security -i 에 명령을 표준 입력으로
    execFileSync('security', ['-i'], { input: `add-generic-password -U -s ${KEYCHAIN} -a hai -w ${token}\n`, stdio: ['pipe', 'ignore', 'ignore'] });
  } else if (store() === 'win32') {
    // 토큰은 표준 입력으로 넘긴다(명령줄에 남지 않게). DPAPI — 이 Windows 사용자만 풀 수 있다
    ps(`$t = [Console]::In.ReadToEnd().Trim(); ConvertTo-SecureString $t -AsPlainText -Force | ConvertFrom-SecureString | Set-Content -NoNewline -LiteralPath '${fileOf().replace(/'/g, "''")}'`, token);
  } else {
    fs.writeFileSync(fileOf(), token, { mode: 0o600 });
  }
  cached = token;
}

export function clearToken() {
  try {
    if (store() === 'darwin') execFileSync('security', ['delete-generic-password', '-s', KEYCHAIN], { stdio: 'ignore' });
  } catch { /* 없음 */ }
  try { fs.rmSync(fileOf(), { force: true }); } catch { /* 없음 */ }
  cached = '';
}

/** 기본 브라우저로 열기. HAI_LOGIN_OPEN=print 면 열지 않고 돌려준다(시험용) */
function openBrowser(url) {
  if (process.env.HAI_LOGIN_OPEN === 'print') return;
  const p = os.platform();
  // Windows: URL 의 & 를 셸이 자르지 않게 Start-Process 에 작은따옴표로 넘긴다(URL 에 작은따옴표는 없다)
  const [cmd, args] = p === 'darwin' ? ['open', [url]] : p === 'win32' ? ['powershell.exe', ['-NoProfile', '-Command', `Start-Process '${url}'`]] : ['xdg-open', [url]];
  spawn(cmd, args, { stdio: 'ignore', detached: true, windowsHide: true }).unref();
}

const PAGE = (title, body) => `<!doctype html><html lang="ko"><meta charset="utf-8"><title>${title}</title>
<body style="font-family:'Noto Sans KR',sans-serif;max-width:520px;margin:80px auto;padding:0 16px;word-break:keep-all">
<h1 style="font-size:24px">${title}</h1><p>${body}</p></body></html>`;

/**
 * 로그인 — 브라우저에서 통합인증을 마치면 끝난다. onUrl(url): 연 주소를 알린다(브라우저가 안 열릴 때 사용자에게 보여 주게)
 * → { name, email }
 */
export async function login({ timeoutMs = 5 * 60_000, onUrl } = {}) {
  const state = randomBytes(24).toString('base64url');
  const verifier = randomBytes(32).toString('base64url');
  const challenge = createHash('sha256').update(verifier).digest('base64url');
  let finish;
  const done = new Promise((ok, no) => { finish = { ok, no }; });
  const server = http.createServer((req, res) => {
    const u = new URL(req.url, 'http://127.0.0.1');
    if (u.pathname !== '/callback') { res.writeHead(404).end(); return; }
    if (u.searchParams.get('state') !== state || !u.searchParams.get('code')) {
      res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' }).end(PAGE('로그인 실패', 'Claude Code 에서 다시 시도하세요.'));
      finish.no(new Error('로그인 응답이 맞지 않습니다(state). 다시 시도하세요.'));
      return;
    }
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }).end(PAGE('로그인되었습니다', '이 창을 닫고 Claude Code 로 돌아가세요.'));
    finish.ok(u.searchParams.get('code'));
  });
  await new Promise((ok, no) => server.once('error', no).listen(0, '127.0.0.1', ok));
  const { port } = server.address();
  const url = `${config.agentUrl}/auth/hai/start?${new URLSearchParams({ port: String(port), state, challenge })}`;
  onUrl?.(url);
  openBrowser(url);
  const timer = setTimeout(() => finish.no(new Error(`${Math.round(timeoutMs / 60000)}분 안에 로그인이 끝나지 않았습니다. 다시 시도하세요.`)), timeoutMs);
  try {
    const code = await done;
    const res = await fetch(`${config.agentUrl}/auth/hai/token`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code, verifier, device: os.hostname().slice(0, 40) }),
      signal: AbortSignal.timeout(30_000),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.token) throw new Error(data.message ?? `로그인 서버 응답 오류(${res.status})`);
    saveToken(data.token);
    try { fs.writeFileSync(path.join(config.dataDir, 'agent-user.json'), JSON.stringify({ name: data.name, email: data.email, at: new Date().toISOString() })); } catch { /* 표시용 */ }
    return { name: data.name, email: data.email };
  } finally {
    clearTimeout(timer);
    server.close();
  }
}

/** 서버에서 토큰을 지우고 이 PC 에서도 지운다 */
export async function logout() {
  const t = loadToken();
  if (t) await fetch(`${config.agentUrl}/auth/hai/logout`, { method: 'POST', headers: { Authorization: `Bearer ${t}` }, signal: AbortSignal.timeout(15_000) }).catch(() => {});
  clearToken();
  try { fs.rmSync(path.join(config.dataDir, 'agent-user.json'), { force: true }); } catch { /* 없음 */ }
}

/** 로그인한 사람(표시용, 비밀 아님) → { name, email } | null */
export function loginUser() {
  if (!loadToken()) return null;
  try { return JSON.parse(fs.readFileSync(path.join(config.dataDir, 'agent-user.json'), 'utf8')); } catch { return { name: '', email: '' }; }
}
