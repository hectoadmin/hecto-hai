// hai 로그인 토큰 보호 — 토큰 파일(~/.hai-mcp/agent-token · agent-token.dpapi)은 경로로 비교해 막고(와일드카드·상대 경로·변수로 쪼갠 이름도),
// 키체인·Windows 자격 증명·DPAPI 에서 비밀값을 꺼내는 명령은 명령 꼴로 막는다. 가린 글(masked/)·타임테이블 규칙 파일은 읽을 수 있어야 한다
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { GUARD } from './guard-fixture.js';

const WIN = process.platform === 'win32';
const bashTest = WIN ? test.skip : test; // bash 문법·POSIX 경로 — Windows Git Bash 꼴은 아래 따로

/** 홈을 임시 폴더로 — ~ · $HOME 이 이 폴더를 가리킨다. token: 토큰 파일을 둘지(Windows DPAPI·리눅스 파일 저장소), 없으면 macOS 키체인 꼴 */
function home({ token = true } = {}) {
  const root = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'hai-guard-token-')));
  const data = path.join(root, '.hai-mcp');
  fs.mkdirSync(path.join(data, 'masked'), { recursive: true });
  fs.writeFileSync(path.join(data, 'masked', '계약서.md'), 'x');
  fs.writeFileSync(path.join(data, 'timetable-rules.md'), 'x');
  fs.writeFileSync(path.join(data, 'agent-user.json'), '{}');
  if (token) { fs.writeFileSync(path.join(data, 'agent-token'), 'x'); fs.writeFileSync(path.join(data, 'agent-token.dpapi'), 'x'); }
  const proj = path.join(root, 'proj');
  fs.mkdirSync(proj, { recursive: true });
  const decide = (tool_name, tool_input, cwd = proj) => {
    const out = execFileSync(process.execPath, [GUARD], {
      input: JSON.stringify({ tool_name, tool_input, cwd }),
      env: { ...process.env, HOME: root, USERPROFILE: root, CLAUDE_PLUGIN_OPTION_PROTECTED_DIRS: '', HAI_DATA_DIR: data, HAI_RAW_DIR: path.join(root, '없는 원문 폴더') },
    }).toString();
    return out ? JSON.parse(out).hookSpecificOutput.permissionDecision : 'allow';
  };
  return { root, data, proj, decide };
}

const { root, data, proj, decide } = home();
/** 모두 기대한 결정인지 — 틀린 것을 모아 한 번에 보여 준다 */
const expectAll = (want, cases, d = decide) => assert.deepEqual(cases.filter(([t, i]) => d(t, i) !== want).map(([t, i]) => `${t} ${JSON.stringify(i)}`), []);
const bash = (cs) => cs.map((command) => ['Bash', { command }]);
const pwsh = (cs) => cs.map((command) => ['PowerShell', { command }]);

test('토큰 파일: Read·Edit·Write·Grep 으로 직접 열거나 고치지 못한다(상대 경로·~ 꼴도)', () => {
  expectAll('deny', [
    ['Read', { file_path: '~/.hai-mcp/agent-token' }],
    ['Read', { file_path: path.join(data, 'agent-token') }],
    ['Read', { file_path: path.join(data, 'agent-token.dpapi') }],
    ['Read', { file_path: path.join('..', '.hai-mcp', 'agent-token') }],
    ['Read', { file_path: path.join(data, 'masked', '..', 'agent-token') }],
    ['Edit', { file_path: path.join(data, 'agent-token'), old_string: 'x', new_string: 'y' }],
    ['Write', { file_path: path.join(data, 'agent-token'), content: 'y' }],
    ['Grep', { pattern: '.', path: path.join(data, 'agent-token') }],
    ['Grep', { pattern: '.', path: data }],
  ]);
});

test('가린 글(masked/)·타임테이블 규칙 파일·로그인과 상관없는 글은 막지 않는다', () => {
  expectAll('allow', [
    ['Read', { file_path: path.join(data, 'masked', '계약서.md') }],
    ['Read', { file_path: '~/.hai-mcp/masked/계약서.md' }],
    ['Read', { file_path: path.join(data, 'timetable-rules.md') }],
    ['Write', { file_path: path.join(data, 'timetable-rules.md'), content: 'y' }],
    ['Edit', { file_path: path.join(data, 'timetable-rules.md'), old_string: 'x', new_string: 'y' }],
    ['Glob', { pattern: '*', path: data }],
    // 토큰 이름이 글로만 나오는 것(소스 고치기·커밋 메시지)은 경로가 아니다
    ['Edit', { file_path: path.join(proj, 'login.js'), old_string: 'a', new_string: "const KEYCHAIN = 'hai-agent-token'; // agent-token.dpapi" }],
    ['Grep', { pattern: 'agent-token', path: proj }],
  ]);
});

bashTest('Bash: 와일드카드·상대 경로·변수로 쪼갠 이름·명령 치환으로도 토큰 파일을 열지 못한다', () => {
  expectAll('deny', bash([
    'cat ~/.hai-mcp/agent-token',
    'cat ~/.hai-mcp/agent-tok*',
    'cat ~/.hai-mcp/*',
    'cat ~/.hai-mcp/agent-token.d*',
    'cat ~/.hai*/agent-token',
    'cat ~/.*/agent-?oken',
    'cat ~/.hai-mcp/{agent-token,x}',
    'cat "$HOME"/.hai-mcp/agent-token',
    'cat ../.hai-mcp/agent-token',
    'cd ~/.hai-mcp && cat agent-token',
    'cd ~/.hai-mcp && cat *',
    'a=agent; b=token; cat ~/.hai-mcp/$a-$b',
    'f=agent-tok; cat ~/.hai-mcp/${f}en',
    'd=~/.hai-mcp; cat $d/agent-token',
    'cat ~/.hai-mcp/$(echo agent-token)',
    'cat $(echo ~/.hai-mcp)/agent-token',
    'ls ~/.hai-mcp | xargs -I{} cat ~/.hai-mcp/{}',
    'for f in ~/.hai-mcp/*; do cat "$f"; done',
    'cp ~/.hai-mcp/agent-token /tmp/x',
    'ln -s ~/.hai-mcp/agent-token ./t',
    'grep -r . ~/.hai-mcp',
    'grep -r . ~',
    'tar czf /tmp/x.tgz ~/.hai-mcp',
    "find ~ -name 'agent-*' -exec cat {} +",
    `python3 -c "print(open('$HOME/.hai-mcp/agent-token').read())"`,
    `python3 -c "import os;print(open(os.path.join(os.path.expanduser('~'),'.hai-mcp','agent-token')).read())"`,
    "python3 - <<'PY'\nimport os\nprint(open(os.path.expanduser('~/.hai-mcp/agent-token')).read())\nPY",
  ]));
});

bashTest('Bash: 실행하는 스크립트 파일이 토큰 파일을 읽어도 막는다', () => {
  const f = path.join(proj, 'peek.py');
  fs.writeFileSync(f, "import os\nprint(open(os.path.expanduser('~/.hai-mcp/agent-token')).read())\n");
  assert.equal(decide('Bash', { command: 'python3 peek.py' }), 'deny');
});

bashTest('Bash: 가린 글·규칙 파일·이름 보기·상관없는 명령은 통과', () => {
  expectAll('allow', bash([
    'ls ~/.hai-mcp',
    'ls -la ~/.hai-mcp/agent-*', // 이름만 보기
    'cat ~/.hai-mcp/masked/계약서.md',
    'cat ~/.hai-mcp/masked/*',
    'cat ~/.hai-mcp/timetable-rules.md',
    'cd ~/.hai-mcp && cat masked/계약서.md',
    'grep -r foo .',
    'git commit -m "agent-token 보호 고침"',
    'grep -n agent-token src/login.js',
    'security find-generic-password -s hai-agent-token', // 항목 속성만(비밀값 없음)
  ]));
});

bashTest('Bash: 토큰 파일이 없으면(macOS 키체인) 홈 전체 검색은 막지 않는다', () => {
  const h = home({ token: false });
  expectAll('allow', [['Bash', { command: 'grep -r foo ~' }], ['Grep', { pattern: 'foo', path: h.root }]], h.decide);
  // 그래도 토큰 파일 자리를 직접·와일드카드로 가리키면 막는다(나중에 생길 수 있다)
  expectAll('deny', bash(['cat ~/.hai-mcp/agent-tok*', 'cat ~/.hai-mcp/agent-token']), h.decide);
});

test('키체인·자격 증명에서 비밀값을 꺼내는 명령은 막는다(macOS security)', () => {
  expectAll('deny', bash([
    'security find-generic-password -s hai-agent-token -w',
    'security find-generic-password -s hai-* -w',
    'security find-generic-password -s hai-agent-token -g',
    'security find-generic-password -ws hai-agent-token',
    '/usr/bin/security find-internet-password -s example.com -w',
    's=security; $s find-generic-password -a hai -w',
    'a=-w; security find-generic-password -s hai $a',
    'security dump-keychain',
    'security dump-keychain -d ~/Library/Keychains/login.keychain-db',
    'security export -k login.keychain -t all -o /tmp/x.p12',
    'security -i <<< "find-generic-password -s hai-agent-token -w"',
    'echo "dump-keychain" | security -i',
    `python3 -c "import subprocess;print(subprocess.run(['security','find-generic-password','-s','hai-agent-token','-w'],capture_output=True).stdout)"`,
    `node -e "console.log(require('child_process').execFileSync('security',['find-generic-password','-s','x','-w']).toString())"`,
    `python3 -c "import keyring;print(keyring.get_password('hai-agent-token','hai'))"`,
  ]));
});

const WIN_SECRET = [
    "$s = Get-Content -Raw x.txt | ConvertTo-SecureString; [Runtime.InteropServices.Marshal]::PtrToStringBSTR([Runtime.InteropServices.Marshal]::SecureStringToBSTR($s))",
    "[Security.Cryptography.ProtectedData]::Unprotect($b, $null, 'CurrentUser')",
    "(Get-Credential).GetNetworkCredential().Password",
    "$s | ConvertFrom-SecureString -AsPlainText",
    "(New-Object System.Net.NetworkCredential('', $s)).Password",
    "[Windows.Security.Credentials.PasswordVault]::new().RetrieveAll()",
    "Get-StoredCredential -Target hai",
    "Get-Secret -Name hai -AsPlainText",
];
test('Windows 자격 증명·DPAPI 를 푸는 명령은 막는다(PowerShell·Git Bash 안의 PowerShell)', () => {
  expectAll('deny', pwsh(WIN_SECRET));
  expectAll('allow', pwsh(['Get-Content ./notes.txt']));
});
bashTest('Git Bash 에서 부르는 PowerShell 로도 자격 증명·DPAPI 를 풀지 못한다', () => {
  expectAll('deny', bash(WIN_SECRET.map((c) => `pwsh -NoProfile -Command "${c.replace(/[$"`\\]/g, '\\$&')}"`)));
});

test('PowerShell: 와일드카드·변수·Join-Path·목록 넘기기로도 토큰 파일을 열지 못한다', () => {
  expectAll('deny', pwsh([
    `Get-Content '${path.join(data, 'agent-token.dpapi')}'`,
    `Get-Content '${path.join(data, 'agent-tok*')}'`,
    `Get-Content '${path.join(data, '*')}'`,
    `$d = '${data}'; Get-Content (Join-Path $d 'agent-token.dpapi')`,
    `Get-ChildItem '${data}' | Get-Content`,
    `Copy-Item '${path.join(data, 'agent-token.dpapi')}' '${proj}'`,
    'Get-Content ~/.hai-mcp/agent-token.dpapi',
  ]));
  expectAll('allow', pwsh([
    `Get-Content '${path.join(data, 'masked', '계약서.md')}'`,
    `Get-ChildItem '${data}'`,
    `Get-Content '${path.join(data, 'timetable-rules.md')}'`,
  ]));
});

test('Windows: $env:USERPROFILE · %USERPROFILE% · Git Bash /c/… 꼴로도 토큰 파일을 열지 못한다', { skip: !WIN }, () => {
  const gb = (p) => p.replace(/^([A-Za-z]):/, (_, d) => `/${d.toLowerCase()}`).replace(/\\/g, '/');
  const f = path.join(data, 'agent-token.dpapi');
  expectAll('deny', pwsh([
    'Get-Content $env:USERPROFILE\\.hai-mcp\\agent-token.dpapi | ConvertTo-SecureString',
    'Get-Content "$env:USERPROFILE\\.hai-mcp\\agent-tok*"',
    'Get-Content (Join-Path $env:USERPROFILE ".hai-mcp\\agent-token.dpapi")',
    'type %USERPROFILE%\\.hai-mcp\\agent-token.dpapi',
  ]));
  expectAll('deny', [...bash([`cat ${gb(f)}`, `cat "${f}"`, `cat ${gb(data)}/agent-tok*`, `cat ${gb(data)}/*`, `cat "${gb(f).toUpperCase()}"`]), ['Read', { file_path: f.toUpperCase() }]]);
  expectAll('allow', bash([`cat ${gb(path.join(data, 'masked', '계약서.md'))}`]));
});

// 남겨 둔 임시 폴더 정리
process.on('exit', () => { try { fs.rmSync(root, { recursive: true, force: true }); } catch { /* 없음 */ } });
