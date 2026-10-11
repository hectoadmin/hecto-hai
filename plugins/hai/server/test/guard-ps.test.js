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

test('검토: 띄어쓰기 든 경로(OneDrive - Hecto)도 PowerShell 에서 막는다', () => {
  const od = path.join(root, 'OneDrive - Hecto', '문서');
  const odhr = path.join(od, '인사');
  fs.mkdirSync(odhr, { recursive: true });
  fs.writeFileSync(path.join(odhr, 'a.txt'), 'x');
  fs.mkdirSync(path.join(od, '인사 자료'), { recursive: true });
  const d = (command, cwd = root) => decide('PowerShell', { command }, cwd, odhr);
  for (const c of [
    `Get-ChildItem '${od}' -Recurse | Select-String '홍길동'`,
    `Get-ChildItem -Path "${od}" -Recurse -File | Get-Content`,
    `Get-Content '${path.join(od, '인?', 'a.txt')}'`,
    `Copy-Item '${od}' 'backup' -Recurse`,
    `Get-Content '${path.join(odhr, 'a.txt')}'`,
  ]) assert.equal(d(c), 'deny', c);
  assert.equal(d(`Get-ChildItem '${od}'`), 'allow');
  assert.equal(d(`Get-Content '${path.join(od, '인사 자료', 'b.txt')}'`), 'allow'); // 이름이 비슷한 다른 폴더
});

test('검토: 이름만 보는 명령 목록 밖은 내용을 읽는 것으로 — COM·Rename·목록을 받아 읽기', () => {
  for (const c of [
    `$w = New-Object -ComObject Word.Application; $w.Documents.Open('${raw}').Content.Text`,
    `Rename-Item '${raw}' x.txt`,
    `(Get-Item '${raw}').CopyTo('${path.join(desk, 'c.txt')}')`,
    `ipcsv '${raw}'`,
    `Get-ChildItem '${docs}' -File | ForEach-Object { Get-Content $_.FullName }`,
  ]) assert.equal(ps(c), 'deny', c);
  assert.equal(ps('Get-ChildItem -File | Get-Content', docs), 'deny');
});

test('검토: 상위 폴더를 하위까지 훑는 스크립트·인라인 코드는 막는다', () => {
  const walk = path.join(desk, 'walk.py');
  fs.writeFileSync(walk, `from pathlib import Path\nfor p in (Path.home() / 'Documents').rglob('*.txt'):\n    print(p.read_text())\n`);
  const walk2 = path.join(desk, 'walk2.py');
  fs.writeFileSync(walk2, `import glob\nfor f in glob.glob(r'${docs}/**/*.txt', recursive=True):\n    print(open(f).read())\n`);
  const deskOnly = path.join(desk, 'desk.py');
  fs.writeFileSync(deskOnly, `from pathlib import Path\nfor p in (Path.home() / 'Desktop').rglob('*.txt'):\n    print(p)\n`);
  assert.equal(decide('Bash', { command: 'python3 walk2.py' }, desk), 'deny');
  assert.equal(decide('Bash', { command: 'python3 -m walk2' }, desk), 'deny');
  assert.equal(decide('Bash', { command: `python3 -c "import os\nfor r, d, f in os.walk('${docs}'): print(f)"` }), 'deny');
  assert.equal(ps('python .\\walk2.py', desk), 'deny');
  assert.equal(decide('Bash', { command: 'python3 -c "import os; [print(r) for r,_,_ in os.walk(\'.\')]"' }, docs), 'deny'); // 작업 폴더가 상위
  assert.equal(decide('Bash', { command: 'python3 walk.py' }, desk), 'deny'); // 보호 폴더의 상위 이름('Documents')을 훑는다
  assert.equal(decide('Bash', { command: 'python3 desk.py' }, desk), 'allow');
});

test('검토: 흔한 낱말·옵션은 막지 않는다 — 따옴표 안 "인사", -Depth, -e, GetString', () => {
  const rep = path.join(desk, 'report.py');
  fs.writeFileSync(rep, `import pandas as pd\ndf = pd.read_csv('staff.csv')\nprint(df[df['부서'] == '인사'])\n`);
  for (const [tool, c, cwd] of [
    ['PowerShell', "Get-Content memo.txt | Select-String '인사'", desk],
    ['PowerShell', "git commit -m '인사'", desk],
    ['PowerShell', 'Get-Process | Select-Object -First 3 | ConvertTo-Json -Depth 3', root],
    ['PowerShell', 'git log -r', root],
    ['PowerShell', 'docker run -e DATABASE_URL=postgres://x app', root],
    ['PowerShell', '[Text.Encoding]::UTF8.GetString($r.RawContentStream.ToArray())', root],
    ['Bash', 'python3 report.py', desk],
    ['Bash', `node -e "console.log('인사')"`, desk],
    ['Bash', 'git add .', desk],
  ]) assert.equal(decide(tool, { command: c }, cwd), 'allow', c);
});

test('재검토: Start-Process·& "python.exe"·작업 폴더 기준 상대 경로·바이트 배열·find -exec 로도 못 피한다', () => {
  const plain = path.join(desk, 'plain.py');
  fs.writeFileSync(plain, `print(open(r'${raw}').read())\n`);
  for (const [tool, c, cwd] of [
    ['PowerShell', 'Start-Process python -ArgumentList plain.py -NoNewWindow -Wait', desk],
    ['PowerShell', `Start-Process cmd -ArgumentList '/c type "${raw}"' -NoNewWindow -Wait`, desk],
    ['PowerShell', `& "${path.join(desk, 'python.exe')}" -c "print(open(r'${raw}').read())"`, desk],
    ['PowerShell', `python -c "import os; print(open(os.path.join('인사', 'a.txt')).read())"`, docs],
    ['Bash', `cd '${docs}' && python3 -c "import os; os.chdir('인사'); print(open('a.txt').read())"`, root],
    ['PowerShell', `Get-Content ([Text.Encoding]::UTF8.GetString([byte[]](0x2f,0x74)))`, root],
    ['Bash', 'find . -name "*.py" -exec python3 plain.py \;', desk],
    ['PowerShell', `New-Item -ItemType HardLink -Path x.txt -Target '${raw}'`, desk],
  ]) assert.equal(decide(tool, { command: c }, cwd), 'deny', c);
});

test('재검토: 홈을 훑는 코드는 다른 폴더 이름을 끼워 넣어도 막는다', () => {
  const f = path.join(desk, 'home_walk.py');
  fs.writeFileSync(f, `from pathlib import Path\nfor p in Path.home().rglob('*.txt'):\n    if 'AppData' in p.parts or 'Desktop' in p.parts: continue\n    print(p)\n`);
  assert.equal(decide('Bash', { command: 'python3 home_walk.py' }, desk, path.join(process.env.HOME ?? process.env.USERPROFILE, 'Documents', '인사')), 'deny');
});

test('재검토: 마크다운 ** 와 다른 곳을 훑는 코드는 홈에서도 막지 않는다', () => {
  const home = path.dirname(docs); // 보호 폴더의 상위의 상위 = 작업 폴더가 상위인 상황
  for (const [tool, c] of [
    ['Bash', 'git commit -m "**중요** 수정"'],
    ['PowerShell', 'Set-Content out.md "**제목**"'],
    ['Bash', `python3 -c "print('**bold**')"`],
    ['Bash', `python3 -c "import os; print(list(os.walk('${desk}')))"`],
    ['Bash', `python3 -c "import glob; print(glob.glob('${desk}/**/*.py', recursive=True))"`],
    ['Bash', 'python3 report.py'],
    ['PowerShell', `(Get-ChildItem '${desk}').Count`],
  ]) assert.equal(decide(tool, { command: c }, tool === 'Bash' && c.includes('report') ? desk : home), 'allow', c);
});
