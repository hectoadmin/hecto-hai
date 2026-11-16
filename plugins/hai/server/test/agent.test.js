import { test } from 'node:test';
import assert from 'node:assert/strict';
import { describeRun, describeStop, ensureChrome, extensionLine, notifyText, pickRecipe, waitRun } from '../src/agent.js';
import { BROWSERS, EXTENSION_ID, chromeCommand, defaultBrowser, hasExtension, openChrome, pickBrowser, siteUrl, winProgId } from '../src/chrome.js';

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

test('엣지 켜는 명령 — 윈도우는 msedge.exe, 맥은 Microsoft Edge', () => {
  const env = { PROGRAMFILES: 'C:\\Program Files', 'PROGRAMFILES(X86)': 'C:\\Program Files (x86)' };
  const win = chromeCommand(['https://a/'], { platform: 'win32', env, exists: (p) => p.includes('(x86)') && p.endsWith('msedge.exe'), browser: BROWSERS.edge });
  assert.deepEqual(win, { cmd: 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe', args: ['https://a/'] });
  assert.deepEqual(chromeCommand([], { platform: 'darwin', browser: BROWSERS.edge }), { cmd: 'open', args: ['-g', '-a', 'Microsoft Edge'] });
  assert.throws(() => chromeCommand([], { platform: 'win32', env: {}, exists: () => false, browser: BROWSERS.edge }), /엣지를 찾지 못했습니다/);
});

const REG = (choice, latest) => ['', 'HKEY_CURRENT_USER\\Software\\Microsoft\\Windows\\Shell\\Associations\\UrlAssociations\\https\\UserChoice', `    ProgId    REG_SZ    ${choice}`, '',
  ...(latest ? ['HKEY_CURRENT_USER\\Software\\Microsoft\\Windows\\Shell\\Associations\\UrlAssociations\\https\\UserChoiceLatest\\ProgId', `    ProgId    REG_SZ    ${latest}`, ''] : []),
  '검색 완료: 1개 일치 항목이 있습니다.'].join('\r\n');

test('기본 브라우저 — 윈도우 레지스트리에서 엣지일 때만 엣지', () => {
  assert.equal(winProgId(REG('MSEdgeHTM')), 'MSEdgeHTM');
  assert.equal(winProgId(REG('MSEdgeHTM', 'ChromeHTML')), 'ChromeHTML');   // 새 Windows 는 UserChoiceLatest 가 먼저
  assert.equal(winProgId(''), null);
  const win = (out) => defaultBrowser({ platform: 'win32', env: { SystemRoot: 'C:\\Windows' }, exec: (cmd, args) => { assert.equal(cmd, 'C:\\Windows\\System32\\reg.exe'); assert.equal(args[0], 'query'); return out; } });
  assert.equal(win(REG('MSEdgeHTM')), 'edge');
  assert.equal(win(REG('ChromeHTML')), 'chrome');
  assert.equal(win(REG('WhaleHTML')), 'chrome');   // 그 밖은 전처럼 크롬
  assert.equal(defaultBrowser({ platform: 'win32', exec: () => { throw new Error('키 없음'); } }), 'chrome');
  const mac = (id) => defaultBrowser({ platform: 'darwin', home: '/Users/a', exec: () => JSON.stringify([{ LSHandlerURLScheme: 'http', LSHandlerRoleAll: 'x' }, { LSHandlerURLScheme: 'https', LSHandlerRoleAll: id }]) });
  assert.equal(mac('com.microsoft.edgemac'), 'edge');
  assert.equal(mac('com.google.chrome'), 'chrome');
  assert.equal(defaultBrowser({ platform: 'linux', exec: () => 'microsoft-edge.desktop\n' }), 'edge');
});

test('확장이 어느 브라우저에 올라가 있나 — 프로필 설정 파일에서 확장 ID 를 찾는다', () => {
  const files = { 'C:\\U\\L\\Microsoft\\Edge\\User Data\\Profile 2\\Secure Preferences': `{"extensions":{"settings":{"${EXTENSION_ID}":{}}}}` };
  const opt = { platform: 'win32', env: { LOCALAPPDATA: 'C:\\U\\L' }, readdir: () => ['Default', 'Profile 2', 'Crashpad'], read: (p) => { if (!(p in files)) throw new Error('없음'); return files[p]; } };
  assert.equal(hasExtension(BROWSERS.edge, opt), true);
  assert.equal(hasExtension(BROWSERS.chrome, opt), false);
  assert.equal(hasExtension(BROWSERS.edge, { ...opt, readdir: () => { throw new Error('폴더 없음'); } }), false);
  assert.equal(hasExtension(BROWSERS.edge, { ...opt, env: {} }), false);
  const disabled = { ...opt, read: () => JSON.stringify({ extensions: { settings: { [EXTENSION_ID]: { state: 0 } } } }) };
  assert.equal(hasExtension(BROWSERS.edge, disabled), false);
  assert.equal(hasExtension(BROWSERS.edge, { ...disabled, read: () => JSON.stringify({ extensions: { settings: { [EXTENSION_ID]: { state: 1 } } } }) }), true);
  const trace = { ...opt, read: () => `{"extensions":{"settings":{},"pinned_extensions":["${EXTENSION_ID}"]}}` };   // 지운 뒤 남은 흔적
  assert.equal(hasExtension(BROWSERS.edge, trace), false);
  const mac = { platform: 'darwin', home: '/Users/a', readdir: (p) => { assert.equal(p, '/Users/a/Library/Application Support/Google/Chrome'); return ['Default']; }, read: () => `{"extensions":{"settings":{"${EXTENSION_ID}":{"path":"/x"}}}}` };
  if (process.platform !== 'win32') assert.equal(hasExtension(BROWSERS.chrome, mac), true);   // 경로 구분자가 / 인 곳에서만
});

test('쓸 브라우저 — 기본이 엣지면 엣지, 확장이 크롬에만 있으면 크롬', () => {
  const pick = (def, ext, installed = ['chrome', 'edge']) => pickBrowser({ platform: 'win32', def: () => def, has: (b) => ext.includes(b.id), installed: (b) => installed.includes(b.id) }).id;
  assert.equal(pick('chrome', []), 'chrome');
  assert.equal(pick('chrome', ['edge']), 'chrome');          // 기본이 크롬이면 그대로
  assert.equal(pick('edge', []), 'edge');                    // 처음 설치
  assert.equal(pick('edge', ['edge']), 'edge');
  assert.equal(pick('edge', ['chrome', 'edge']), 'edge');
  assert.equal(pick('edge', ['chrome']), 'chrome');          // 기본은 엣지인데 크롬에 깔아 쓰던 사람
  assert.equal(pick('chrome', [], ['edge']), 'edge');        // 크롬이 안 깔린 PC
  assert.equal(pick('edge', [], ['chrome']), 'chrome');
});

test('openChrome 은 이상한 주소를 넘기기 전에 거절한다', async () => {
  let ran = false;
  await assert.rejects(openChrome(['--remote-debugging-port=9222'], { run: () => { ran = true; } }), /열 수 없습니다/);
  assert.equal(ran, false);
});

test('확장이 꺼져 있으면 크롬을 켜고 연결될 때까지 기다린다', async () => {
  let opened = 0;
  const pick = () => BROWSERS.chrome;   // 이 PC 의 기본 브라우저에 기대지 않게
  const seq = [false, false, false, true];
  assert.equal(await ensureChrome({ online: async () => seq.shift(), pick, open: async () => { opened++; }, sleep: async () => {} }), true);
  assert.equal(opened, 1);
  const seen = [];
  let used;
  await ensureChrome({ online: async () => seen.length > 0, pick: () => BROWSERS.edge, open: async (urls, o) => { used = o.browser; }, sleep: async () => {}, onProgress: (m) => seen.push(m) });
  assert.deepEqual(seen, ['엣지를 켜는 중']);
  assert.equal(used, BROWSERS.edge);
  opened = 0;
  assert.equal(await ensureChrome({ online: async () => true, open: async () => { opened++; } }), true);
  assert.equal(opened, 0);
  assert.equal(await ensureChrome({ online: async () => false, pick, open: async () => {}, sleep: async () => {}, tries: 2 }), false);
  assert.equal(await ensureChrome({ online: async () => false, pick, open: async () => { throw new Error('없음'); } }), false);
});

test('hai_status 의 크롬 확장 줄', async () => {
  assert.equal(await extensionLine(async () => true), '크롬 확장: 연결됨');
  assert.match(await extensionLine(async () => false, () => BROWSERS.chrome), /연결 안 됨.*크롬을 켜고.*로그인/);
  assert.match(await extensionLine(async () => false, () => BROWSERS.edge), /엣지를 켜고/);
  assert.equal(await extensionLine(async () => { throw new Error('x'); }), '크롬 확장: 확인하지 못함');
});

test('봇 DM 글 — 주소는 빼고 자동 알림으로 표시한다', () => {
  assert.equal(notifyText('긴급: 서버 장애'), '[자동 알림] 긴급: 서버 장애');
  assert.equal(notifyText('확인 https://evil.example/login?a=1 바람'), '[자동 알림] 확인 [주소 생략] 바람');
  assert.equal(notifyText('HTTP://A.B www.evil.example/x'), '[자동 알림] [주소 생략] [주소 생략]');
});

test('agent_stop 결과 글', () => {
  assert.match(describeStop(7, { stopped: true, state: 'waiting' }), /#7.*시작하기 전에 취소/);
  assert.match(describeStop(7, { stopped: true, state: 'running' }), /동작 하나를 마치면/);
  assert.match(describeStop(7, { stopped: false, state: 'starting' }), /다시 agent_stop/);
  assert.match(describeStop(7, { stopped: false, state: 'finished' }), /이미 끝난/);
  // 진행 중·패널 전용 확인에서 멈추는 길은 agent_stop
  assert.match(describeRun({ id: 3, recipe: 'x', status: 'running', steps: 2 }), /agent_stop \{run: 3\}/);
  assert.match(describeRun({ id: 3, recipe: 'x', status: 'question', steps: 2, question: { id: 1, kind: 'approve', text: '확인', chatOk: false } }), /agent_stop \{run: 3\}/);
});
