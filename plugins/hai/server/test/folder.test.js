import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { folderInfo, listFiles } from '../src/search.js';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hai-folder-'));
const put = (p) => { fs.mkdirSync(path.dirname(path.join(root, p)), { recursive: true }); fs.writeFileSync(path.join(root, p), 'x'); };
for (const p of ['a.pdf', 'b.docx', '계약/c.pdf', '계약/2026/d.txt', '사진/e.png', '녹음/f.m4a', '기타/g.zip', '기타/.숨김.txt', '~$임시.docx', '.git/h.txt', 'node_modules/i.txt']) put(p);
test.after(() => fs.rmSync(root, { recursive: true, force: true }));

test('폴더 살펴보기 — 세기만 하고 이름을 돌려주지 않는다', async () => {
  const r = await folderInfo(root);
  assert.equal(r.files, 7);   // 임시·숨긴 폴더 뺌, 숨긴 파일은 SKIP_DIR 이 뺌
  assert.equal(r.readable, 4);
  assert.equal(r.media, 2);
  assert.deepEqual(r.types, { '.pdf': 2, '.docx': 1, '.txt': 1, '.png': 1, '.m4a': 1, '.zip': 1 });
  assert.deepEqual(r.folders, { '(이 폴더)': 2, 계약: 2, 사진: 1, 녹음: 1, 기타: 1 });
  assert.ok(r.oldest <= r.newest);
  assert.doesNotMatch(JSON.stringify(r), /a\.pdf|c\.pdf/);
});

test('많으면 세다가 멈춘다', async () => {
  const r = await folderInfo(root, { limit: 3 });
  assert.equal(r.files, 3);
  assert.equal(r.truncated, true);
});

test('하위 폴더까지 목록 — 사진·녹음은 media 일 때만', async () => {
  const rel = (l) => l.map((p) => path.relative(root, p).normalize('NFC')).sort();
  assert.deepEqual(rel(await listFiles(root)), ['a.pdf', 'b.docx', path.join('계약', '2026', 'd.txt'), path.join('계약', 'c.pdf')].map((p) => p.normalize('NFC')).sort());
  assert.equal((await listFiles(root, { media: true })).length, 6);
});
