// 크롬 확장이 대화방 원문 찾기 결과를 잠깐 두는 다운로드 폴더(~/Downloads/hai-chat-find) — 내용 읽기는 막고 이름 보기는 둔다
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { GUARD } from './guard-fixture.js';

const root = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'hai-guard-chat-')));
const dl = path.join(root, 'Downloads', 'hai-chat-find');
fs.mkdirSync(dl, { recursive: true });
const file = path.join(dl, '웍스 대화 가상방 2026-11-01~2026-11-15.txt');
fs.writeFileSync(file, '원문');
const data = path.join(root, 'hai-data');
fs.mkdirSync(data, { recursive: true });

function decide(tool_name, tool_input) {
  const out = execFileSync(process.execPath, [GUARD], {
    input: JSON.stringify({ tool_name, tool_input, cwd: root }),
    env: { ...process.env, HOME: root, USERPROFILE: root, CLAUDE_PLUGIN_OPTION_PROTECTED_DIRS: '', HAI_DATA_DIR: data, HAI_RAW_DIR: path.join(root, '없는 원문 폴더') },
  }).toString();
  return out ? JSON.parse(out).hookSpecificOutput.permissionDecision : 'allow';
}

test('다운로드 폴더의 hai-chat-find 파일은 Read 로 열지 못한다', () => {
  assert.equal(decide('Read', { file_path: file }), 'deny');
  assert.equal(decide('Grep', { pattern: '회식', path: dl }), 'deny');
});

const bashTest = process.platform === 'win32' ? test.skip : test;
bashTest('내용을 읽는 명령은 막고, 이름만 보는 명령은 둔다', () => {
  assert.equal(decide('Bash', { command: `cat "${file}"` }), 'deny');
  assert.equal(decide('Bash', { command: `ls "${dl}"` }), 'allow');
});
