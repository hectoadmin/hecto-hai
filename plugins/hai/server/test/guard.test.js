import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const GUARD = fileURLToPath(new URL('../../hooks/guard.mjs', import.meta.url));
const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'hai-guard-')));
const docs = path.join(root, 'Documents');
const hr = path.join(docs, '인사');
fs.mkdirSync(hr, { recursive: true });
fs.writeFileSync(path.join(hr, 'a.txt'), 'x');
const data = path.join(root, '.hai-mcp');
fs.mkdirSync(data, { recursive: true });
const raw = path.join(docs, '회의 받아쓰기.txt');
fs.writeFileSync(path.join(data, 'raw-files.log'), `${raw}\n`);

function decide(tool_name, tool_input, cwd = root, protectedDirs = hr) {
  const out = execFileSync(process.execPath, [GUARD], {
    input: JSON.stringify({ tool_name, tool_input, cwd }),
    env: { ...process.env, CLAUDE_PLUGIN_OPTION_PROTECTED_DIRS: protectedDirs, HAI_DATA_DIR: data },
  }).toString();
  return out ? JSON.parse(out).hookSpecificOutput.permissionDecision : 'allow';
}

test('보호 폴더 파일 직접 열기는 막는다 — NFD·대소문자 표기도', () => {
  assert.equal(decide('Read', { file_path: path.join(hr, 'a.txt') }), 'deny');
  assert.equal(decide('Read', { file_path: path.join(hr, 'a.txt').normalize('NFD') }), 'deny');
  if (process.platform === 'darwin') assert.equal(decide('Read', { file_path: path.join(root, 'DOCUMENTS', '인사', 'a.txt') }), 'deny');
  assert.equal(decide('Edit', { file_path: path.join(hr, 'a.txt') }), 'deny');
  assert.equal(decide('Read', { file_path: path.join(docs, 'other.txt') }), 'allow');
});

test('HAI 가 만든 원문 파일(받아쓰기·실명 복원)도 막는다', () => {
  assert.equal(decide('Read', { file_path: raw }), 'deny');
  assert.equal(decide('Bash', { command: `cat "${raw}"` }), 'deny');
  assert.equal(decide('Read', { file_path: path.join(data, 'tmp', 'x.wav') }), 'deny');
});

test('Grep·Glob: 안이나 상위를 훑으면 막고, 상관없는 곳은 통과', () => {
  assert.equal(decide('Grep', { pattern: '홍', path: hr }), 'deny');
  assert.equal(decide('Grep', { pattern: '홍', path: docs }), 'deny');
  assert.equal(decide('Grep', { pattern: '홍', path: path.join(root, 'elsewhere') }), 'allow');
  assert.equal(decide('Glob', { pattern: '**/*.txt', path: docs }), 'deny');
  assert.equal(decide('Glob', { pattern: '*.txt', path: docs }), 'allow');
});

test('Bash: 경로·상위 재귀·cd 뒤 상대 경로는 막는다', () => {
  assert.equal(decide('Bash', { command: `cat ${path.join(hr, 'a.txt')}` }), 'deny');
  assert.equal(decide('Bash', { command: `grep -rn 홍길동 ${docs}` }), 'deny');
  assert.equal(decide('Bash', { command: `cd ${docs} && cat 인사/a.txt` }), 'deny');
  assert.equal(decide('Bash', { command: 'grep -r 홍길동 .' }, docs), 'deny');
  assert.equal(decide('Bash', { command: 'cat */*.txt' }, docs), 'deny');
  assert.equal(decide('Bash', { command: 'head -5 a.txt' }, hr), 'deny');
  assert.equal(decide('Bash', { command: `cat "$HOME/x/인사/a.txt"` }), 'deny');
});

test('Bash: 상관없는 명령은 통과 — 이름이 글자로만 나오거나 한 폴더 와일드카드', () => {
  assert.equal(decide('Bash', { command: 'git commit -m "인사말 수정"' }, path.join(root, 'elsewhere')), 'allow');
  assert.equal(decide('Bash', { command: 'ls *.txt' }, docs), 'allow');
  assert.equal(decide('Bash', { command: 'npm test' }, docs), 'allow');
  assert.equal(decide('Bash', { command: `ls ${docs}` }), 'allow');
});

test('검토 2차: 한 폴더 와일드카드로 원문 파일을 읽으면 막고, 역순 옵션·경로를 준 명령은 통과', () => {
  assert.equal(decide('Bash', { command: `cat ${docs}/*.txt` }), 'deny');
  assert.equal(decide('Bash', { command: 'head -50 *받아쓰기*' }, docs), 'deny');
  assert.equal(decide('Bash', { command: 'grep -l 결정 *.txt' }, docs), 'deny');
  assert.equal(decide('Bash', { command: 'cat *.md' }, docs), 'allow');
  assert.equal(decide('Bash', { command: `ls -lrt ${path.join(root, 'Desktop')}` }, root), 'allow');
  assert.equal(decide('Bash', { command: 'sort -r x.txt' }, root), 'allow');
  assert.equal(decide('Bash', { command: `find ${path.join(root, 'Desktop')} -name "*.pdf"` }, root), 'allow');
  assert.equal(decide('Bash', { command: `cp -r ${path.join(root, 'a')} ${path.join(root, 'b')}` }, root), 'allow');
  assert.equal(decide('Bash', { command: 'find . -name "*.txt"' }, root), 'deny');
  assert.equal(decide('Bash', { command: 'rg 홍길동' }, root), 'deny');
  assert.equal(decide('Bash', { command: 'ls -R' }, docs), 'deny');
});

test('보호 폴더 설정이 없거나 채워지지 않으면 원문 파일만 막는다', () => {
  assert.equal(decide('Read', { file_path: path.join(hr, 'a.txt') }, root, ''), 'allow');
  assert.equal(decide('Read', { file_path: path.join(hr, 'a.txt') }, root, '${user_config.protected_dirs}'), 'allow');
  assert.equal(decide('Read', { file_path: raw }, root, ''), 'deny');
});
