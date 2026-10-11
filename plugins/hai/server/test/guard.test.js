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
fs.writeFileSync(raw, 'x');
const gone = path.join(root, 'Desktop', '지운 받아쓰기.txt'); // 장부엔 있지만 지운 파일
fs.mkdirSync(path.join(root, 'Desktop'), { recursive: true });
const spaced = path.join(docs, '인사 자료');
fs.mkdirSync(spaced, { recursive: true });
fs.writeFileSync(path.join(data, 'raw-files.log'), `${raw}\n${gone}\n`);

function decide(tool_name, tool_input, cwd = root, protectedDirs = hr) {
  const out = execFileSync(process.execPath, [GUARD], {
    input: JSON.stringify({ tool_name, tool_input, cwd }),
    env: { ...process.env, CLAUDE_PLUGIN_OPTION_PROTECTED_DIRS: protectedDirs, HAI_DATA_DIR: data, HAI_RAW_DIR: path.join(root, '없는 원문 폴더') },
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

test('검토 3차: 공백 든 이름·따옴표·python·heredoc 으로 원문 파일을 읽으면 막는다', () => {
  const esc = raw.replace(/ /g, '\\ ');
  assert.equal(decide('Bash', { command: `cat ${esc}` }), 'deny');
  assert.equal(decide('Bash', { command: `python3 -c "print(open('${raw}').read())"` }), 'deny');
  assert.equal(decide('Bash', { command: "python3 - <<'EOF'\nprint(open('회의 받아쓰기.txt').read())\nEOF" }, docs), 'deny');
  assert.equal(decide('Bash', { command: `cat ${path.join(spaced, 'a.txt').replace(/ /g, '\\ ')}` }, root, spaced), 'deny');
  assert.equal(decide('Bash', { command: `cat "${path.join(spaced, 'a.txt')}"` }, root, spaced), 'deny');
});

test('검토 3차: 내부 tmp·지운 원문 파일·이름만 보는 명령·마크다운은 막지 않는다', () => {
  assert.equal(decide('Bash', { command: 'ls /tmp' }, root, ''), 'allow');
  assert.equal(decide('Bash', { command: 'cat /tmp/build.log' }, root, ''), 'allow');
  assert.equal(decide('Bash', { command: 'python3 ~/work/tmp/a.py' }, root, ''), 'allow');
  assert.equal(decide('Bash', { command: `grep -rn 결정 ${path.join(root, 'Desktop')}` }, root, ''), 'allow');
  assert.equal(decide('Grep', { pattern: '결정', path: path.join(root, 'Desktop') }, root, ''), 'allow');
  assert.equal(decide('Bash', { command: `ls -l "${raw}"` }), 'allow');
  assert.equal(decide('Bash', { command: `open "${raw}"` }), 'allow');
  assert.equal(decide('Bash', { command: "cat > /tmp/x.md <<'EOF'\n**굵게** a / b\nEOF" }), 'allow');
});

test('검토 3차: 상위 폴더 검색을 막을 때는 범위를 좁히라고 안내', () => {
  const out = execFileSync(process.execPath, [GUARD], { input: JSON.stringify({ tool_name: 'Glob', tool_input: { pattern: '**/*.pdf' }, cwd: root }),
    env: { ...process.env, CLAUDE_PLUGIN_OPTION_PROTECTED_DIRS: hr, HAI_DATA_DIR: data, HAI_RAW_DIR: path.join(root, '없는 원문 폴더') } }).toString();
  assert.match(JSON.parse(out).hookSpecificOutput.permissionDecisionReason, /더 좁은 폴더/);
});

test('보안 검토: 셸 따옴표·이스케이프·와일드카드·중괄호·명령 치환으로 경로를 감춰도 막는다', () => {
  for (const c of [
    `cat ${docs}/인?/a.txt`, `cat ${docs}/인[사]/a.txt`, `cat ${docs}/\\인사/a.txt`, `cat ${docs}/인''사/a.txt`, `cat ${docs}/인""사/a.txt`,
    `cat "${docs}/인"사/a.txt`, `cat ${docs}/{인사,x}/a.txt`, `D=${docs}; cat $D/인?/a.txt`, `cat $(ls -d ${docs}/인*)/a.txt`,
    `cat "${docs}/회의 받아쓰"기.txt`, `cat ${docs}/회의?받아쓰기.txt`,
  ]) assert.equal(decide('Bash', { command: c }), 'deny', c);
});

test('보안 검토: 셸 단어 풀기가 평범한 명령을 막지 않는다', () => {
  for (const [c, w] of [['echo "hello world" | wc -c', root], [`ls "${docs}"`, root], ['git log --oneline -5', root], [`python3 -c "print(1+1)"`, root], ['cat notes.md', path.join(root, 'elsewhere')]]) {
    assert.equal(decide('Bash', { command: c }, w), 'allow', c);
  }
});

test('보안 검토 2: $\'…\' 이스케이프·eval·base64 로 숨긴 경로는 막는다', () => {
  const enc = [...Buffer.from('인사')].map((b) => `\\x${b.toString(16)}`).join('');
  assert.equal(decide('Bash', { command: `cat ${docs}/$'${enc}'/a.txt` }), 'deny');
  assert.equal(decide('Bash', { command: `eval "cat $X"` }), 'deny');
  assert.equal(decide('Bash', { command: `cat $(echo Li4v | base64 -d)` }), 'deny');
});

test('보안 검토 2: 아주 넓은 와일드카드도 빨리 판단하고, 파일이 많아도 놓치지 않는다', () => {
  const t0 = Date.now();
  assert.equal(decide('Bash', { command: 'cat /*/*/*/*/*/*/*/*.txt' }), 'allow');
  assert.ok(Date.now() - t0 < 3000, `느림 ${Date.now() - t0}ms`);
  const pad = path.join(docs, 'pad');
  fs.mkdirSync(pad, { recursive: true });
  for (let i = 0; i < 600; i++) fs.writeFileSync(path.join(pad, `회의 ${String(i).padStart(3, '0')}.txt`), '');
  assert.equal(decide('Bash', { command: `cat ${docs}/회의*` }), 'deny'); // 원문 파일 "회의 받아쓰기.txt" 가 600개 뒤에 있어도
});

test('검토 4차: 명령 치환 안의 cat, 값을 모르는 변수로 원문 파일을 열면 막는다', () => {
  assert.equal(decide('Bash', { command: `echo "$(cat ${raw.replace(/ /g, '\\ ')})"` }), 'deny');
  assert.equal(decide('Bash', { command: `echo \`cat ${docs}/*.txt\`` }), 'deny');
  assert.equal(decide('Bash', { command: `f=$(ls -t ${docs} | head -1); cat ${docs}/"$f"` }), 'deny');
});

test('검토 4차: 따옴표 안 * 와 이름만 찾는 검색은 막지 않는다', () => {
  assert.equal(decide('Bash', { command: 'python3 -c "print(3 * 4)"' }), 'allow');
  assert.equal(decide('Bash', { command: 'sqlite3 a.db "SELECT * FROM t"' }), 'allow');
  assert.equal(decide('Bash', { command: `awk '{print $1 * 2}' ${path.join(root, 'Desktop', 'a.csv')}` }, docs), 'allow');
  // 원문 파일만 있는 폴더(보호 폴더 없음)에서 이름 찾기
  assert.equal(decide('Glob', { pattern: '**/*.xlsx', path: docs }, root, ''), 'allow');
  assert.equal(decide('Bash', { command: `find ${docs} -maxdepth 1 -name "*.pdf"` }, root, ''), 'allow');
  assert.equal(decide('Bash', { command: `grep -rn 결정 ${docs}` }, root, ''), 'deny'); // 내용을 읽는 재귀는 원문 파일도 본다
});

test('와일드카드 ** 가 많아도 빨리 판단한다', () => {
  const t0 = Date.now();
  decide('Bash', { command: `cat ${'/**'.repeat(40)}/x.txt` });
  assert.ok(Date.now() - t0 < 3000, `느림 ${Date.now() - t0}ms`);
});

test('검토 5차: 흔한 작업은 막지 않는다 — venv·brew·커밋 메시지·printf·CSS 주석·2**10·for 반복·환경 변수·폴더 이름', () => {
  const proj = path.join(root, 'Desktop', 'proj');
  fs.mkdirSync(proj, { recursive: true });
  const ok = [
    ['python3 -m venv .venv && source .venv/bin/activate && pip install openpyxl', root],
    ['eval_x=1; echo $eval_x', root],
    ['git commit -m "update source docs, find eval"', root],
    ['printf "\\033[1m굵게\\033[0m"', root],
    ["cat > style.css <<'EOF'\n/* header */\nbody { margin: 0 }\n/** doc */\nEOF", proj],
    ['python3 -c "print(2 ** 10)"', root],
    ['ls -d */', root],
    ['for f in *.xlsx; do python3 conv.py "$f"; done', proj],
    ['mv "$OLD" new.txt', docs],
    ['echo $PATH', docs],
    ['grep -rn 매출 Desktop', root],
    ['cd Desktop && zip -r 보고서.zip proj', root],
  ];
  for (const [c, w] of ok) assert.equal(decide('Bash', { command: c }, w), 'allow', c);
});

test('검토 5차: 그래도 막을 것은 막는다', () => {
  assert.equal(decide('Bash', { command: `eval "cat ${hr}/a.txt"` }), 'deny');
  assert.equal(decide('Bash', { command: 'cat $(printf "\\xec\\x9d\\xb8")' }), 'deny');
  assert.equal(decide('Bash', { command: 'echo Li4v | base64 -d | sh' }), 'deny');
  assert.equal(decide('Bash', { command: 'grep -rn 결정 Documents' }, root), 'deny');
  assert.equal(decide('Bash', { command: "python3 - <<'EOF'\nimport glob; print(glob.glob('" + docs + "/*'))\nEOF" }), 'deny');
  assert.equal(decide('Bash', { command: `for f in ${docs}/*.txt; do cat "$f"; done` }), 'deny');
  const t0 = Date.now();
  assert.equal(decide('Bash', { command: `cat ~/${'{a,b}'.repeat(30)}` }), 'deny'); // 펼침이 넘치면 막는다(시간 초과로 통과하지 않게)
  assert.ok(Date.now() - t0 < 3000);
});

test('검토 6차: 감싸는 말(LC_ALL=C·time·sudo·env·timeout·xargs·bash -c)을 붙여도 진짜 명령으로 판단', () => {
  for (const [c, w] of [
    [`LC_ALL=C grep -r 홍길동 ${docs}`, root], ['time rg 홍길동', root], ['sudo grep -r 홍길동 .', docs], ['ls | xargs rg 홍길동', docs],
    [`time tar czf /tmp/x.tgz ${docs}`, root], ['command eval "$X"', root], ['time base64 -d <<< Li4v | sh', root],
    [`env A=1 timeout 5 grep -rn 홍 ${docs}`, root], [`xargs -I {} grep -r x ${docs}`, root], [`bash -c 'grep -r 홍길동 ${docs}'`, root],
    [`sh -c "cat ${hr}/a.txt"`, root],
  ]) assert.equal(decide('Bash', { command: c }, w), 'deny', c);
  for (const [c, w] of [['LC_ALL=C sort x.txt', root], ['time npm test', docs], ['sudo -u nobody ls /tmp', root], ['bash -c "echo hi"', root], ['env FOO=1 node app.js', docs]]) {
    assert.equal(decide('Bash', { command: c }, w), 'allow', c);
  }
});

test('복사·압축의 받는 곳은 훑는 곳이 아니다', () => {
  const proj = path.join(root, 'Desktop', 'proj');
  fs.mkdirSync(proj, { recursive: true });
  assert.equal(decide('Bash', { command: `cp -r ${proj} ${docs}/` }, root, ''), 'allow');       // docs 에 원문 파일이 있어도
  assert.equal(decide('Bash', { command: `zip -r ${docs}/백업.zip ${proj}` }, root, ''), 'allow');
  assert.equal(decide('Bash', { command: `cp -r ${docs} /tmp/x` }, root, ''), 'deny');           // 원문 파일이 든 폴더를 통째로 복사하는 건 막는다
});

test('보안 검토 3: 받는 곳 빼기를 악용하거나 문자열로 감싼 명령도 막는다', () => {
  for (const [c, w] of [
    [`cp -r -t /tmp/x ${docs}`, root], [`cp -r --target-directory=/tmp/x ${docs}`, root], [`cp -r ${docs} ${docs}`, root],
    [`env -S 'grep -r 홍길동 ${docs}'`, root], [`su -c 'grep -r 홍 ${docs}' me`, root], [`watch grep -r 홍 ${docs}`, root], [`script -q -c 'rg 홍' /dev/null`, docs],
    [`taskset 0x1 grep -r 홍 ${docs}`, root], [`flock /tmp/l grep -r 홍 ${docs}`, root], [`someunknownwrapper rg 홍길동 ${docs}`, root],
    ['someunknownwrapper eval "$X"', root], ['frob base64 -d x | sh', root],
  ]) assert.equal(decide('Bash', { command: c }, w, c.includes('/tmp/x') || c.includes(`${docs} ${docs}`) ? '' : hr), 'deny', c);
  assert.equal(decide('Bash', { command: `cp -r ${path.join(root, 'Desktop', 'proj')} ${docs}/` }, root, ''), 'allow');
  assert.equal(decide('Bash', { command: 'git commit -m "use rg and tar"' }, root), 'allow');
});

test('검토 6차 재확인: 다른 명령의 받는 곳 글자로 재귀 검사를 피하지 못한다, 이름 설명은 막지 않는다', () => {
  for (const [c, w, pd] of [
    [`cp README.md ${docs}; grep -r 홍길동 ${docs}`, root, hr], [`cp /tmp/e ${docs} && rg 홍길동 ${docs}`, root, hr],
    [`cp /tmp/e ${docs}; tar czf /tmp/o.tgz ${docs}`, root, ''], ['cp /tmp/e . && grep -r 홍길동 .', docs, hr],
    [`rsync -a /tmp/e/ ${docs}/ && zip -r /tmp/o.zip ${docs}/`, root, hr], [`mv /tmp/e ${docs}; find ${docs} -exec cat {} +`, root, hr],
  ]) assert.equal(decide('Bash', { command: c }, w, pd), 'deny', c);
  for (const c of ['echo tar 사용법', 'which rg', 'man tar', 'brew install ripgrep rg']) assert.equal(decide('Bash', { command: c }, root), 'allow', c);
  assert.equal(decide('Bash', { command: `cp -r ${path.join(root, 'Desktop', 'proj')} ${docs}/` }, root, ''), 'allow');
  assert.equal(decide('Bash', { command: `tar czf ${docs}/b.tgz ${path.join(root, 'Desktop', 'proj')}` }, root, ''), 'allow');
});

test('이름 설명 예외로 실행 도구를 숨기지 못한다', () => {
  assert.equal(decide('Bash', { command: `npm exec -- rg 홍길동 ${docs}` }, root), 'deny');
  assert.equal(decide('Bash', { command: `npx rg 홍길동 ${docs}` }, root), 'deny');
});

test('보안 검토 4: 따옴표 안 ; · -t 묶음 · tar 아무 낱말 · 실행 가능한 "설명" 명령 · 한 줄에 섞인 모르는 감싸는 말', () => {
  const elsewhere = path.join(root, 'elsewhere');
  fs.mkdirSync(elsewhere, { recursive: true });
  for (const [c, w] of [
    [`grep -r "x;y" ${docs}`, elsewhere], [`grep -r 'a|b' ${docs}`, elsewhere],
    [`cp -tr /tmp/x ${docs}`, elsewhere], [`cp -rt /tmp/x ${docs}`, elsewhere], [`tar -c foo ${docs}`, elsewhere],
    [`man -P "rg 홍길동 ${docs}" tar`, elsewhere], [`brew sh -c "grep -r 홍 ${docs}"`, elsewhere],
    [`grep -r x /tmp; weirdwrap rg 홍 ${docs}`, elsewhere],
  ]) assert.equal(decide('Bash', { command: c }, w), 'deny', c);
  for (const c of ['grep -rn "TODO;" src', 'echo "a;b" | wc -c', `cp -r ${path.join(root, 'Desktop', 'proj')} /tmp/y`]) assert.equal(decide('Bash', { command: c }, elsewhere), 'allow', c);
});

test('man 은 옵션 없이만 설명으로 본다', () => {
  assert.equal(decide('Bash', { command: 'man tar' }, root), 'allow');
  assert.equal(decide('Bash', { command: `man -P "cat ${hr}/a.txt" tar` }, root), 'deny');
  assert.equal(decide('Bash', { command: `nice -n 5 bash -c "rg 홍 ${docs}"` }, path.join(root, 'elsewhere')), 'deny');
});

test('검토 6차 재확인 2: 큰따옴표 안 명령 치환도 명령으로, cp -a, tar 목록·풀기·-C', () => {
  for (const [c, w] of [
    ['echo "$(rg 홍)"', docs], ['echo "$(grep -r 홍 .)"', docs], ['echo "`rg 홍`"', docs], ['x="$(rg 홍)"; echo $x', docs],
    ['echo "$(tar cf - .)"', docs], [`echo "$(sh -c 'rg 홍')"`, docs], [`echo "$(grep -r 홍 ${docs})"`, root],
    [`cp -a ${docs} /tmp/x`, path.join(root, 'elsewhere')],
  ]) assert.equal(decide('Bash', { command: c }, w), 'deny', c);
  const dl = path.join(root, 'Downloads');
  fs.mkdirSync(dl, { recursive: true });
  for (const c of [`tar tzf ${dl}/x.tgz`, `tar xzf ${dl}/x.tgz -C /tmp/out`, `tar czf ${docs}/proj.tgz -C ${path.join(root, 'Desktop')} proj`, "echo '$(rg 홍)'"]) {
    assert.equal(decide('Bash', { command: c }, root, ''), 'allow', c);
  }
});

test('원문 결과 폴더는 설정하지 않아도 보호 폴더처럼 막는다', () => {
  const rawDir = path.join(root, 'HAI 원문');
  fs.mkdirSync(rawDir, { recursive: true });
  const run = (tool_name, tool_input) => {
    const out = execFileSync(process.execPath, [GUARD], { input: JSON.stringify({ tool_name, tool_input, cwd: root }),
      env: { ...process.env, CLAUDE_PLUGIN_OPTION_PROTECTED_DIRS: '', HAI_DATA_DIR: data, HAI_RAW_DIR: rawDir } }).toString();
    return out ? 'deny' : 'allow';
  };
  assert.equal(run('Read', { file_path: path.join(rawDir, '회의 받아쓰기.txt') }), 'deny');
  assert.equal(run('Bash', { command: `cat "${rawDir}"/*.txt` }), 'deny');
  assert.equal(run('Read', { file_path: path.join(root, 'Desktop', 'a.txt') }), 'allow');
});

test('원문 결과 폴더: 이름 보기·크기·셸 설정 eval 은 괜찮고, 내용 읽기·모르는 eval 은 막는다', () => {
  const rawDir = path.join(root, 'Documents', 'HAI 원문');
  fs.mkdirSync(rawDir, { recursive: true });
  fs.writeFileSync(path.join(rawDir, '회의 받아쓰기.txt'), 'x');
  const run = (tool_name, tool_input, cwd = root) => {
    const out = execFileSync(process.execPath, [GUARD], { input: JSON.stringify({ tool_name, tool_input, cwd }),
      env: { ...process.env, CLAUDE_PLUGIN_OPTION_PROTECTED_DIRS: '', HAI_DATA_DIR: data, HAI_RAW_DIR: rawDir } }).toString();
    return out ? 'deny' : 'allow';
  };
  for (const [t, i] of [['Bash', { command: `ls "${rawDir}"` }], ['Bash', { command: `open "${rawDir}"` }], ['Bash', { command: `du -sh ${docs}/*` }],
    ['Bash', { command: `find ${docs} -name "*.pdf"` }], ['Glob', { pattern: '*.txt', path: rawDir }], ['Bash', { command: 'eval "$(/opt/homebrew/bin/brew shellenv)"' }],
    ['Bash', { command: 'eval "$(pyenv init -)"' }]]) assert.equal(run(t, i), 'allow', JSON.stringify(i));
  for (const [t, i] of [['Bash', { command: `cat "${rawDir}"/*.txt` }], ['Read', { file_path: path.join(rawDir, '회의 받아쓰기.txt') }],
    ['Bash', { command: `grep -r 결정 ${docs}` }], ['Grep', { pattern: '결정', path: rawDir }], ['Bash', { command: 'eval "$(cat x)"' }]]) assert.equal(run(t, i), 'deny', JSON.stringify(i));
});
