import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import JSZip from 'jszip';
import { downloadExtension, installSteps, safeParts, unpackExtension, unpackedVersion } from '../src/extension.js';
import { chromeCommand, openExtensionsPage } from '../src/chrome.js';

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'hai-ext-'));
async function zipOf(files) {
  const z = new JSZip();
  for (const [name, body] of Object.entries(files)) z.file(name, body);
  return z.generateAsync({ type: 'nodebuffer' });
}
const manifest = (version, key = 'KEY-A') => JSON.stringify({ manifest_version: 3, name: '헥토 AI 브라우저 에이전트', version, key });
const pack = (version, extra = {}, key) => zipOf({
  'README.txt': '설치 안내', 'guide.html': '<p>사용 안내</p>',
  'hecto-agent-extension/manifest.json': manifest(version, key),
  'hecto-agent-extension/sidepanel.js': `// ${version}`,
  'hecto-agent-extension/lib/page.js': 'x',
  ...extra,
});

test('압축 안 경로 — 폴더 밖으로 나가는 이름은 받지 않는다', () => {
  assert.deepEqual(safeParts('lib/page.js'), ['lib', 'page.js']);
  for (const bad of ['../x.js', 'a/../../x', '/etc/passwd', 'C:\\x', 'a\\b', 'c:x', '', './x', 'a/./b']) assert.equal(safeParts(bad), null, bad);
});

test('처음 설치 — 확장 폴더만 풀고 안내 파일은 두지 않는다', async () => {
  const dir = path.join(tmp(), 'hecto-agent-extension');
  const r = await unpackExtension(await pack('0.9.0'), dir);
  assert.deepEqual({ version: r.version, previous: r.previous, files: r.files }, { version: '0.9.0', previous: null, files: 3 });
  assert.equal(r.dir, path.resolve(dir));
  assert.deepEqual(fs.readdirSync(dir).sort(), ['lib', 'manifest.json', 'sidepanel.js']);
  assert.equal(await unpackedVersion(dir), '0.9.0');
  assert.equal(await unpackedVersion(path.join(dir, 'none')), null);
});

test('새 버전 — 같은 폴더에 덮어쓰고 없어진 파일은 지운다', async () => {
  const dir = path.join(tmp(), 'hecto-agent-extension');
  await unpackExtension(await pack('0.9.0', { 'hecto-agent-extension/old.js': 'old' }), dir);
  const r = await unpackExtension(await pack('0.9.1'), dir);
  assert.deepEqual({ version: r.version, previous: r.previous }, { version: '0.9.1', previous: '0.9.0' });
  assert.ok(!fs.existsSync(path.join(dir, 'old.js')));
  assert.equal(fs.readFileSync(path.join(dir, 'sidepanel.js'), 'utf8'), '// 0.9.1');
});

test('다른 것이 든 폴더는 건드리지 않는다', async () => {
  const dir = tmp();
  fs.writeFileSync(path.join(dir, '내 문서.txt'), '중요');
  await assert.rejects(unpackExtension(await pack('0.9.0'), dir), /다른 내용/);
  assert.deepEqual(fs.readdirSync(dir), ['내 문서.txt']);
  // 다른 확장(키가 다름)이 든 폴더도 마찬가지
  const other = path.join(tmp(), 'x');
  await unpackExtension(await pack('1.0.0', {}, 'KEY-B'), other);
  await assert.rejects(unpackExtension(await pack('0.9.0'), other), /다른 내용/);
  assert.equal(await unpackedVersion(other), '1.0.0');
});

test('이상한 압축은 풀지 않는다', async () => {
  const dir = path.join(tmp(), 'e');
  await assert.rejects(unpackExtension(Buffer.from('zip 아님'), dir), /열 수 없습니다/);
  await assert.rejects(unpackExtension(await zipOf({ 'README.txt': 'x' }), dir), /확장 설치 파일이 아닙니다/);
  await assert.rejects(unpackExtension(await zipOf({ 'hecto-agent-extension/manifest.json': '{"version":"1.0.0"}' }), dir), /확장 설치 파일이 아닙니다/);
  await assert.rejects(unpackExtension(await pack('0.9.0', { 'hecto-agent-extension/a\\b.js': 'x' }), dir), /이상한 경로/);
  assert.ok(!fs.existsSync(dir));
});

test('받기 — 토큰으로만, 서버 답에 따라 무엇을 할지 알려 준다', async () => {
  await assert.rejects(downloadExtension({ token: null, fetcher: () => { throw new Error('부르면 안 됨'); } }), /hai_login/);
  let seen;
  const res = (status, body = Buffer.from('zip'), headers = {}) => ({ status, ok: status < 400, headers: new Headers(headers), arrayBuffer: async () => body });
  const got = await downloadExtension({ token: 't'.repeat(30), fetcher: async (url, opt) => { seen = { url, auth: opt.headers.Authorization }; return res(200, Buffer.from('zip'), { 'x-extension-version': '0.9.0' }); } });
  assert.match(seen.url, /\/hai-api\/extension\/download$/);
  assert.equal(seen.auth, `Bearer ${'t'.repeat(30)}`);
  assert.equal(got.version, '0.9.0');
  assert.equal(got.buf.toString(), 'zip');
  await assert.rejects(downloadExtension({ token: 't', fetcher: async () => res(401) }), /다시 로그인/);
  await assert.rejects(downloadExtension({ token: 't', fetcher: async () => res(404) }), /담당자/);
  await assert.rejects(downloadExtension({ token: 't', fetcher: async () => res(200, Buffer.alloc(0), { 'content-length': String(99 * 1024 * 1024) }) }), /너무 큽니다/);
  await assert.rejects(downloadExtension({ token: 't', fetcher: async () => { throw new Error('ECONNREFUSED'); } }), /연결하지 못했습니다/);
});

test('안내 글 — 처음 설치는 순서 다섯, Windows·Mac 폴더 고르는 법이 다르다', () => {
  const win = installSteps({ dir: 'C:\\Users\\홍길동\\hecto-agent-extension', version: '0.9.0', previous: null, opened: true, platform: 'win32' });
  assert.match(win, /C:\\Users\\홍길동\\hecto-agent-extension/);
  assert.match(win, /개발자 모드[\s\S]*압축해제된 확장 프로그램 로드[\s\S]*고정[\s\S]*로그인[\s\S]*이 사이트 허용/);
  assert.match(win, /"폴더" 칸/);
  const mac = installSteps({ dir: '/Users/a/hecto-agent-extension', version: '0.9.0', previous: null, opened: false, platform: 'darwin' });
  assert.match(mac, /Cmd\+Shift\+G/);
  assert.match(mac, /주소창에 chrome:\/\/extensions 를 넣어/);
});

test('안내 글 — 새 버전은 다시 불러오기만', () => {
  const up = installSteps({ dir: '/x', version: '0.9.1', previous: '0.9.0', opened: true, platform: 'darwin' });
  assert.match(up, /0\.9\.0 → 0\.9\.1/);
  assert.match(up, /다시 불러오기/);
  assert.match(installSteps({ dir: '/x', version: '0.9.1', previous: '0.9.1', opened: true }), /다시 받아/);
});

test('확장 화면은 적어 둔 주소 하나만, 앞으로 띄워 연다', async () => {
  assert.deepEqual(chromeCommand(['chrome://extensions'], { platform: 'darwin', front: true }), { cmd: 'open', args: ['-a', 'Google Chrome', 'chrome://extensions'] });
  let ran;
  const fake = (cmd, args) => { ran = { cmd, args }; return { once: (ev, fn) => { if (ev === 'spawn') fn(); }, unref() {} }; };
  if (process.platform === 'win32') return;   // 크롬 설치 위치를 찾는 쪽은 agent.test.js 가 본다
  await openExtensionsPage({ run: fake });
  assert.equal(ran.args.at(-1), 'chrome://extensions');
});
