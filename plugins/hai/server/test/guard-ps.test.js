// PowerShell 도구(Windows 에서 Git Bash 가 없을 때 Claude 가 쓰는 셸)와 스크립트 실행 검사 — 모든 운영체제에서 돈다(경로는 그 운영체제 꼴)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fixture } from './guard-fixture.js';

const { root, docs, hr, desk, raw, decide } = fixture('hai-guard-ps-');
const ps = (command, cwd) => decide('PowerShell', { command }, cwd);

test('PowerShell: 보호 폴더 파일 읽기·복사·찾기는 막는다', () => {
  for (const c of [
    `Get-Content '${path.join(hr, 'a.txt')}'`,
    `gc "${path.join(hr, 'a.txt')}"`,
    `[IO.File]::ReadAllText('${path.join(hr, 'a.txt')}')`,
    `Copy-Item '${hr}' '${desk}' -Recurse`,
    `Select-String -Path '${path.join(hr, '*.txt')}' -Pattern '홍길동'`,
    `Get-Content '${path.join(docs, '인?', 'a.txt')}'`,
    `Get-Content '${raw}'`,
  ]) assert.equal(ps(c), 'deny', c);
});

test('PowerShell: 변수·문자열 잇기·Join-Path·백틱으로 나눈 경로도 막는다', () => {
  for (const c of [
    `$d = '${docs}'; Get-Content (Join-Path $d '인사')`,
    `$d = '${docs}'; Get-ChildItem (Join-Path $d '인사') | Get-Content`,
    `Get-Content ('${docs}${path.sep}' + '인사${path.sep}a.txt')`,
    `$f = '${path.join(hr, 'a.txt')}'; Get-Content $f`,
    `Get-Content '${path.join(docs, '인`사', 'a.txt')}'`,
    `[IO.Path]::Combine('${docs}', '인사', 'a.txt') | Get-Content`,
  ]) assert.equal(ps(c), 'deny', c);
});

test('PowerShell: 글자를 풀어 실행하는 명령(iex·base64·[char])은 막는다', () => {
  for (const c of [
    'iex (Get-Clipboard)',
    `Invoke-Expression "Get-Content x"`,
    `Get-Content ([Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('Li4v')))`,
    `Get-Content ('C:' + [char]0xC778)`,
    'powershell -EncodedCommand ZQBjAGgAbwAgADEA',
  ]) assert.equal(ps(c), 'deny', c);
});

test('PowerShell: 보호 폴더를 품은 폴더를 하위까지 훑어 읽으면 막고, 이름만 보면 둔다', () => {
  assert.equal(ps(`Get-ChildItem '${docs}' -Recurse | Select-String '홍길동'`), 'deny');
  assert.equal(ps(`Get-ChildItem -Recurse -Filter *.txt | Get-Content`, docs), 'deny');
  assert.equal(ps(`robocopy '${docs}' '${desk}' /E`), 'deny');
  assert.equal(ps(`Get-ChildItem '${docs}'`), 'allow');
  assert.equal(ps(`Test-Path '${raw}'`), 'allow');
  assert.equal(ps(`Start-Process '${raw}'`), 'allow'); // 사용자 앱으로 열기
});

test('PowerShell: 평범한 명령은 막지 않는다', () => {
  for (const c of [
    'Get-Date',
    `Get-Content '${path.join(desk, 'memo.txt')}'`,
    `Get-ChildItem '${desk}' -Recurse | Select-String 'TODO'`,
    `New-Item -ItemType Directory -Path '${path.join(desk, 'out')}' -Force`,
    `Get-Process | Sort-Object CPU -Descending | Select-Object -First 5`,
    `"$env:USERNAME"`,
  ]) assert.equal(ps(c), 'allow', c);
});

test('스크립트 실행: 파일 안에 보호 폴더가 있으면 막는다(Claude 가 스크립트를 써서 돌리는 경우)', () => {
  const bad = path.join(desk, 'read_hr.py');
  fs.writeFileSync(bad, `import os\nprint(open(os.path.join(os.path.expanduser('~'), 'Documents', '인사', 'a.txt')).read())\n`);
  const bad2 = path.join(desk, 'read_raw.ps1');
  fs.writeFileSync(bad2, `Get-Content '${raw}'\n`);
  const ok = path.join(desk, 'sum.py');
  fs.writeFileSync(ok, `print(sum(range(10)))\n`);
  assert.equal(decide('Bash', { command: 'python3 read_hr.py' }, desk), 'deny');
  assert.equal(decide('Bash', { command: `cd '${desk}' && python3 read_hr.py` }), 'deny');
  assert.equal(ps('python .\\read_hr.py', desk), 'deny');
  assert.equal(ps('& .\\read_raw.ps1', desk), 'deny');
  assert.equal(ps('.\\read_raw.ps1', desk), 'deny');
  assert.equal(decide('Bash', { command: 'python3 sum.py' }, desk), 'allow');
  assert.equal(ps('python .\\sum.py', desk), 'allow');
  assert.equal(decide('Bash', { command: 'cat read_hr.py' }, desk), 'allow'); // 실행이 아니라 스크립트 보기
});

test('인라인 코드: 경로를 조각으로 이어도 막고, Bash 안에서 부르는 PowerShell 도 본다', () => {
  assert.equal(decide('Bash', { command: `python3 -c "import os; print(os.listdir(os.path.join(os.path.expanduser('~'), 'Documents', '인사')))"` }), 'deny');
  assert.equal(decide('Bash', { command: `powershell -NoProfile -Command "Get-Content '${path.join(hr, 'a.txt')}'"` }), 'deny');
  assert.equal(decide('Bash', { command: `python3 -c "print('hello')"` }), 'allow');
});

test('PowerShell: 작업 폴더가 보호 폴더 안이면 막는다', () => {
  assert.equal(ps('Get-ChildItem', hr), 'deny');
  assert.equal(ps('Get-ChildItem', root), 'allow');
});
