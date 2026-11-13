import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';

// 가짜 agent 서버(/auth/hai/token)와 파일 저장소로 — 실제 브라우저·키체인을 건드리지 않는다
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hai-login-'));
const fake = http.createServer((req, res) => {
  if (req.url !== '/auth/hai/token') { res.writeHead(404).end(); return; }
  let body = '';
  req.on('data', (d) => { body += d; }).on('end', () => {
    const { code } = JSON.parse(body);
    if (code === 'bad') { res.writeHead(400, { 'Content-Type': 'application/json' }).end(JSON.stringify({ message: '코드가 맞지 않습니다' })); return; }
    res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ token: 'T'.repeat(32), name: '홍길동', email: 'gd@hecto.co.kr' }));
  });
});
await new Promise((ok) => fake.listen(0, '127.0.0.1', ok));
Object.assign(process.env, { HAI_AGENT_URL: `http://127.0.0.1:${fake.address().port}`, HAI_DATA_DIR: dataDir, HAI_TOKEN_STORE: 'file', HAI_LOGIN_OPEN: 'print' });
const { browserCommand, currentLogin, loadToken, startLogin } = await import('../src/login.js');
test.after(() => fake.close());

const callback = (url, code) => {
  const u = new URL(url);
  return fetch(`http://127.0.0.1:${u.searchParams.get('port')}/callback?code=${code}&state=${u.searchParams.get('state')}`);
};

test('브라우저 여는 명령 — Windows 는 PowerShell 을 거치지 않고, 주소는 인자 하나로', () => {
  const url = 'https://agent.hecto.co.kr/auth/hai/start?port=5&state=a&challenge=b';
  assert.deepEqual(browserCommand(url, { platform: 'darwin' }), ['open', [url]]);
  assert.deepEqual(browserCommand(url, { platform: 'win32', env: { SystemRoot: 'C:\\Windows' } }), ['C:\\Windows\\System32\\rundll32.exe', ['url.dll,FileProtocolHandler', url]]);
  assert.deepEqual(browserCommand(url, { platform: 'linux' }), ['xdg-open', [url]]);
});

test('시작하면 바로 주소를 돌려주고, 기다리는 동안 다시 불러도 같은 로그인이다', async () => {
  let opened = 0;
  const p = await startLogin({ open: () => { opened++; } });
  assert.match(p.url, /\/auth\/hai\/start\?port=\d+&state=[\w-]+&challenge=[\w-]+$/);
  assert.equal(p.state, 'waiting');
  const again = await startLogin({ open: () => { opened++; } });
  assert.equal(again, p);
  assert.equal(opened, 1);
  assert.equal(currentLogin(), p);

  // 도구 호출이 돌아간 뒤에 브라우저에서 로그인을 마쳐도 뒤에서 끝난다
  const res = await callback(p.url, 'good');
  assert.equal(res.status, 200);
  assert.deepEqual(await p.done, { name: '홍길동', email: 'gd@hecto.co.kr' });
  assert.equal(p.state, 'done');
  assert.equal(loadToken(), 'T'.repeat(32));
  assert.equal(currentLogin()?.state, 'done');
  assert.equal(currentLogin(Date.now() + 3 * 60_000), null);   // 2분 지나면 잊는다 — 다시 부르면 새 로그인
});

test('state 가 다르면 거절하고, 서버가 코드를 안 받으면 실패로 남는다', async () => {
  const p = await startLogin({ open: () => {} });
  const u = new URL(p.url);
  const res = await fetch(`http://127.0.0.1:${u.searchParams.get('port')}/callback?code=x&state=wrong`);
  assert.equal(res.status, 400);
  await assert.rejects(p.done, /state/);
  assert.equal(p.state, 'failed');

  const q = await startLogin({ open: () => {} });
  assert.notEqual(q, p);
  await callback(q.url, 'bad');
  await assert.rejects(q.done, /코드가 맞지 않습니다/);
});

test('시간 안에 끝나지 않으면 실패로 끝나고 기다리던 포트를 닫는다', async () => {
  const p = await startLogin({ open: () => {}, timeoutMs: 50 });
  await assert.rejects(p.done, /끝나지 않았습니다/);
  await assert.rejects(callback(p.url, 'good'));
});
