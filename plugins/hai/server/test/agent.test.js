import { test } from 'node:test';
import assert from 'node:assert/strict';
import { describeRun, ensureChrome, extensionLine, pickRecipe, waitRun } from '../src/agent.js';
import { chromeCommand, openChrome, siteUrl } from '../src/chrome.js';

const list = [
  { id: 3, name: '법인카드 정산' },
  { id: 7, name: '웅진 세금계산서 입력' },
  { id: 9, name: '웅진 세금계산서 확인' },
];

test('작업 고르기 — 번호·이름(띄어쓰기 무시)·하나뿐인 부분 일치', () => {
  assert.equal(pickRecipe(list, '#7').id, 7);
  assert.equal(pickRecipe(list, '9').id, 9);
  assert.equal(pickRecipe(list, '법인카드정산').id, 3);
  assert.equal(pickRecipe(list, '카드').id, 3);
  assert.throws(() => pickRecipe(list, '웅진'), /여럿입니다: #7 .*#9/);
  assert.throws(() => pickRecipe(list, '출장비'), /agent_recipes/);
});

test('끝나거나 확인이 생길 때까지 기다린다', async () => {
  const seq = [{ status: 'waiting' }, { status: 'running', steps: 2, last: 'click · 조회' }, { status: 'question', question: { id: 1, kind: 'approve', text: '클릭 · 저장', chatOk: true } }];
  const seen = [];
  const st = await waitRun(5, { status: async () => seq.shift(), sleep: async () => {}, onProgress: (m) => seen.push(m) });
  assert.equal(st.status, 'question');
  assert.deepEqual(seen, ['크롬에서 시작을 기다리는 중', '2단계 · click · 조회']);
});

test('기다릴 시간이 지나면 진행 중으로 돌려준다', async () => {
  let t = 0;
  const st = await waitRun(5, { waitMs: 5000, every: 2000, now: () => t, sleep: async (ms) => { t += ms; }, status: async () => ({ status: 'running', steps: 1 }) });
  assert.equal(st.status, 'running');
  assert.ok(t <= 5000);
});

test('결과 글 — 대화로 답할 확인은 사용자에게 묻게, 패널 전용은 패널로 안내', () => {
  const base = { id: 5, recipe: '법인카드 정산', steps: 4 };
  const chat = describeRun({ ...base, status: 'question', question: { id: 2, kind: 'approve', text: '클릭 · 임시저장', chatOk: true } });
  assert.match(chat, /사용자에게 이 내용을 그대로 보여 주고/);
  assert.match(chat, /agent_answer \{run: 5, q: 2, answer: "run"\}/);
  const panel = describeRun({ ...base, status: 'question', question: { id: 3, kind: 'approve', text: '클릭 · 결재요청', chatOk: false } });
  assert.match(panel, /크롬 패널에서만/);
  assert.doesNotMatch(panel, /answer: "run"/);
  assert.match(describeRun({ ...base, status: 'question', question: { id: 4, kind: 'ask', text: '몇 월?', chatOk: true } }), /사용자가 답한 글/);
  assert.match(describeRun({ ...base, status: 'done', answer: '3건 저장' }), /완료\(4단계\)\.\n결과: 「3건 저장」 \(「」 안은/);
  assert.match(describeRun({ ...base, status: 'declined', message: '바쁨' }), /시작하지 않음: 바쁨/);
});

test('사이트 이름·주소 — http(s) 만', () => {
  assert.equal(siteUrl('메일'), 'https://mail.worksmobile.com/');
  assert.equal(siteUrl('일정'), 'https://calendar.worksmobile.com/');
  assert.equal(siteUrl('GW'), 'https://gw.hecto.co.kr/');
  assert.equal(siteUrl('https://evs.hecto.co.kr/a?b=1'), 'https://evs.hecto.co.kr/a?b=1');
  for (const bad of ['--load-extension=/tmp/x', 'file:///etc/passwd', 'javascript:alert(1)', '']) assert.throws(() => siteUrl(bad), /열 수 없습니다/);
});

test('크롬 켜는 명령 — 맥은 뒤에서, 윈도우는 설치 경로로 셸 없이', () => {
  assert.deepEqual(chromeCommand(['https://a/'], { platform: 'darwin' }), { cmd: 'open', args: ['-g', '-a', 'Google Chrome', 'https://a/'] });
  const win = chromeCommand(['https://a/?x=1&y=2'], { platform: 'win32', env: { PROGRAMFILES: 'C:\\Program Files', LOCALAPPDATA: 'C:\\U\\L' }, exists: (p) => p.startsWith('C:\\U') });
  assert.equal(win.cmd, 'C:\\U\\L\\Google\\Chrome\\Application\\chrome.exe');
  assert.deepEqual(win.args, ['https://a/?x=1&y=2']);
  assert.throws(() => chromeCommand([], { platform: 'win32', env: {}, exists: () => false }), /찾지 못했습니다/);
});

test('openChrome 은 이상한 주소를 넘기기 전에 거절한다', async () => {
  let ran = false;
  await assert.rejects(openChrome(['--remote-debugging-port=9222'], { run: () => { ran = true; } }), /열 수 없습니다/);
  assert.equal(ran, false);
});

test('확장이 꺼져 있으면 크롬을 켜고 연결될 때까지 기다린다', async () => {
  let opened = 0;
  const seq = [false, false, false, true];
  assert.equal(await ensureChrome({ online: async () => seq.shift(), open: async () => { opened++; }, sleep: async () => {} }), true);
  assert.equal(opened, 1);
  opened = 0;
  assert.equal(await ensureChrome({ online: async () => true, open: async () => { opened++; } }), true);
  assert.equal(opened, 0);
  assert.equal(await ensureChrome({ online: async () => false, open: async () => {}, sleep: async () => {}, tries: 2 }), false);
  assert.equal(await ensureChrome({ online: async () => false, open: async () => { throw new Error('없음'); } }), false);
});

test('hai_status 의 크롬 확장 줄', async () => {
  assert.equal(await extensionLine(async () => true), '크롬 확장: 연결됨');
  assert.match(await extensionLine(async () => false), /연결 안 됨.*로그인/);
  assert.equal(await extensionLine(async () => { throw new Error('x'); }), '크롬 확장: 확인하지 못함');
});
