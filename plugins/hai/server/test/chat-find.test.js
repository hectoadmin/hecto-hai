import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { config } from '../src/config.js';
import { describeChatFind, moveChatFiles } from '../src/agent.js';
import { rawFiles } from '../src/ledger.js';

let root, downloads, rawDir;
before(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'hai-chat-find-'));
  config.dataDir = path.join(root, 'data');   // 실제 장부(~/.hai-mcp)를 건드리지 않는다
  downloads = path.join(root, 'Downloads', 'hai-chat-find');
  rawDir = path.join(root, '원문');
  await fs.mkdir(downloads, { recursive: true });
});
const put = async (name, text = '원문') => { const p = path.join(downloads, name); await fs.writeFile(p, text); return p; };

test('확장이 저장한 파일을 원문 결과 폴더로 옮기고 장부에 올린다', async () => {
  const txt = await put('웍스 대화 가상방 2026-11-01~2026-11-15.txt');
  const csv = await put('웍스 대화 가상방 2026-11-01~2026-11-15.csv');
  const out = await moveChatFiles([txt, csv], { rawDir });
  assert.deepEqual(out.map((o) => o.moved), [true, true]);
  assert.equal(path.dirname(out[0].path), rawDir);
  await assert.rejects(fs.access(txt), '다운로드 폴더에서는 사라진다');
  assert.equal(await fs.readFile(out[0].path, 'utf8'), '원문');
  if (process.platform !== 'win32') assert.equal((await fs.stat(out[0].path)).mode & 0o777, 0o600);   // Windows 엔 유닉스 권한이 없다(늘 666)
  const ledger = await rawFiles();
  assert.ok(ledger.some((p) => p.endsWith('웍스 대화 가상방 2026-11-01~2026-11-15.txt')), '장부에 올라 훅이 Claude 의 열람을 막는다');
  // 다시 불러도(agent_status 를 두 번) 옮긴 곳을 알려 준다
  const again = await moveChatFiles([txt], { rawDir });
  assert.deepEqual(again, [{ path: path.join(rawDir, path.basename(txt)), name: path.basename(txt), moved: true }]);
});

test('확장이 쓰는 모양이 아닌 경로는 옮기지 않는다(서버가 준 경로를 그대로 믿지 않음)', async () => {
  const other = path.join(root, 'secret.txt');
  await fs.writeFile(other, 'x');
  const wrongDir = path.join(root, '웍스 대화 a.txt');
  await fs.writeFile(wrongDir, 'x');
  const out = await moveChatFiles([other, wrongDir, 'relative/hai-chat-find/웍스 대화 a.txt', path.join(downloads, '웍스 대화 없음.txt')], { rawDir });
  assert.deepEqual(out.map((o) => o.moved), [false, false, false, false]);
  assert.ok(out.slice(0, 3).every((o) => o.rejected && !o.path && !o.name), '모양이 다른 경로는 이름도 돌려주지 않는다');
  await fs.access(other);
  await fs.access(wrongDir);
});

test('옮기지 못해도 다운로드 쪽 원본은 먼저 장부에 올리고, 경로는 돌려주지 않는다', async () => {
  const txt = await put('웍스 대화 실패방 2026-11-01~2026-11-02.txt', '비밀');
  const out = await moveChatFiles([txt], { rawDir, move: async () => { const e = new Error(`EACCES: ${txt}`); e.code = 'EACCES'; throw e; } });
  assert.deepEqual(out, [{ name: path.basename(txt), moved: false, why: '옮기기 실패(EACCES)' }]);
  assert.ok((await rawFiles()).some((p) => p.endsWith('웍스 대화 실패방 2026-11-01~2026-11-02.txt')), '원본이 장부에 올라 있다');
  const msg = await describeChatFind({ id: 9, recipe: 'x', status: 'done', count: 1, files: [txt] }, { rawDir, move: async () => { throw Object.assign(new Error('x'), { code: 'EPERM' }); } });
  assert.doesNotMatch(msg, new RegExp(root.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), '절대 경로를 돌려주지 않는다');
  assert.match(msg, /「웍스 대화 실패방 2026-11-01~2026-11-02\.txt」/);
});

test('결과 글 — 건수·파일 위치만, 내용은 없고 Read 대신 hai_ask_file 로 안내', async () => {
  const txt = await put('웍스 대화 결과방 2026-11-01~2026-11-02.txt', '홍길동: 비밀 내용');
  const csv = await put('웍스 대화 결과방 2026-11-01~2026-11-02.csv', '비밀 내용');
  const msg = await describeChatFind({ id: 4, recipe: '대화방 원문 찾기 · 결과방', status: 'done', count: 2, scanned: 80, files: [txt, csv], note: '' }, { rawDir });
  assert.match(msg, /\[대화방 원문 찾기 #4\] 대화방 원문 찾기 · 결과방 — 2건/);
  assert.match(msg, /엑셀용 \.csv 함께/);
  assert.ok(msg.includes(path.join(rawDir, path.basename(txt)).replace(os.homedir(), '~')));
  assert.doesNotMatch(msg, /비밀 내용/);
  assert.match(msg, /hai_ask_file/);
  const short = await describeChatFind({ id: 5, recipe: 'x', status: 'done', count: 0, files: [], note: '요청한 시작일 2026-11-01 보다 늦은 2026-11-05 부터만 읽었습니다' }, { rawDir });
  assert.match(short, /주의: 「요청한 시작일/);
  assert.match(await describeChatFind({ id: 6, recipe: 'x', status: 'failed', message: "'x' 방을 찾지 못했습니다" }), /실패: 'x' 방을 찾지 못했습니다/);
});
