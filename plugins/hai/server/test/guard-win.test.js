// Windows 경로 꼴 — C:\x · C:/x · /c/x(Git Bash) · %LOCALAPPDATA% · $env:LOCALAPPDATA · 대소문자. Windows 에서만 돈다(CI windows-latest)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fixture } from './guard-fixture.js';

const WIN = process.platform === 'win32';
const { root, docs, hr, desk, raw, decide } = WIN ? fixture('hai-guard-win-') : {};
// C:\Users\x\… → /c/Users/x/… (Git Bash 꼴)
const gb = (p) => p.replace(/^([A-Za-z]):/, (_, d) => `/${d.toLowerCase()}`).replace(/\\/g, '/');
const viaLocal = (p) => p.replace(process.env.LOCALAPPDATA, '%LOCALAPPDATA%');
const viaEnv = (p) => p.replace(process.env.LOCALAPPDATA, '$env:LOCALAPPDATA');

test('Windows: Read·Grep·Glob 은 C:\\ · C:/ · 대소문자가 달라도 막는다', { skip: !WIN }, () => {
  const f = path.join(hr, 'a.txt');
  assert.equal(decide('Read', { file_path: f }), 'deny');
  assert.equal(decide('Read', { file_path: f.replace(/\\/g, '/') }), 'deny');
  assert.equal(decide('Read', { file_path: f.toUpperCase() }), 'deny');
  assert.equal(decide('Read', { file_path: raw }), 'deny');
  assert.equal(decide('Grep', { pattern: '홍', path: docs }), 'deny');
  assert.equal(decide('Glob', { pattern: '**/*.txt', path: docs }), 'deny');
  assert.equal(decide('Read', { file_path: path.join(desk, 'memo.txt') }), 'allow');
  assert.equal(decide('Grep', { pattern: '홍', path: desk }), 'allow');
});

test('Windows Git Bash: /c/… · "C:\\…" · C:/… · ~ 꼴 모두 막는다', { skip: !WIN }, () => {
  const f = path.join(hr, 'a.txt');
  for (const c of [
    `cat ${gb(f)}`,
    `cat "${f}"`,
    `cat '${f}'`,
    `cat ${f.replace(/\\/g, '/')}`,
    `cat "${gb(f).toUpperCase()}"`,
    `grep -r 홍 ${gb(docs)}`,
    `cat ${gb(docs)}/인?/a.txt`,
    `cat "${gb(raw)}"`,
  ]) assert.equal(decide('Bash', { command: c }), 'deny', c);
  assert.equal(decide('Bash', { command: `ls ${gb(desk)}` }), 'allow');
  assert.equal(decide('Bash', { command: `cat ${gb(path.join(desk, 'memo.txt'))}` }), 'allow');
});

test('Windows PowerShell·cmd: 환경 변수(%X% · $env:X)로 쓴 경로도 막는다', { skip: !WIN || !process.env.LOCALAPPDATA || !root.startsWith(process.env.LOCALAPPDATA) }, () => {
  const f = path.join(hr, 'a.txt');
  assert.equal(decide('PowerShell', { command: `Get-Content "${viaEnv(f)}"` }), 'deny');
  assert.equal(decide('PowerShell', { command: `cmd /c type "${viaLocal(f)}"` }), 'deny');
  assert.equal(decide('Bash', { command: `cmd //c type "${viaLocal(f)}"` }), 'deny');
  assert.equal(decide('PowerShell', { command: `Get-Content ${f.replace(/\\/g, '/')}` }), 'deny');
  assert.equal(decide('PowerShell', { command: `Get-ChildItem "${viaEnv(docs)}" -Recurse | Select-String 홍` }), 'deny');
  assert.equal(decide('PowerShell', { command: `Get-ChildItem "${viaEnv(desk)}"` }), 'allow');
});

test('Windows: 보호 폴더 설정을 ~ · %USERPROFILE% 꼴로 적어도 된다', { skip: !WIN || !root.toLowerCase().startsWith(process.env.USERPROFILE?.toLowerCase() ?? '\0') }, () => {
  const rel = hr.slice(process.env.USERPROFILE.length);
  for (const setting of [`~${rel.replace(/\\/g, '/')}`, `%USERPROFILE%${rel}`]) {
    assert.equal(decide('Read', { file_path: path.join(hr, 'a.txt') }, root, setting), 'deny', setting);
  }
});

test('Windows: 짧은 이름(RUNNER~1)·없는 파일·NFD 로 적어도 막는다', { skip: !WIN }, () => {
  const tmp = os.tmpdir();
  const long = fs.realpathSync.native(tmp);
  const short = (p) => p.replace(long, tmp);
  assert.equal(decide('Read', { file_path: short(path.join(hr, 'a.txt')) }), 'deny');
  assert.equal(decide('Read', { file_path: short(path.join(hr, '없는 파일.txt')) }), 'deny');
  assert.equal(decide('Read', { file_path: path.join(hr, 'a.txt').normalize('NFD') }), 'deny');
  assert.equal(decide('Read', { file_path: short(raw) }), 'deny');
  assert.equal(decide('PowerShell', { command: `Get-Content '${short(path.join(hr, 'a.txt'))}'` }), 'deny');
});

test('Windows: \\localhost\c$ · FileSystem:: 꼴도 막는다', { skip: !WIN }, () => {
  const f = path.join(hr, 'a.txt');
  assert.equal(decide('PowerShell', { command: `Get-Content '${f.replace(/^([A-Za-z]):/, (_, d) => `\\\\localhost\\${d}$`)}'` }), 'deny');
  assert.equal(decide('PowerShell', { command: `Get-Content 'FileSystem::${f}'` }), 'deny');
  assert.equal(decide('PowerShell', { command: `Get-Content -LiteralPath '${f}'` }), 'deny');
});
