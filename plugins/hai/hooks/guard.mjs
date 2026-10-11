#!/usr/bin/env node
/**
 * 원문 가드 (PreToolUse). Claude 가 Read·Grep·Glob·Bash 등으로 다음을 직접 열지 못하게 막고 HAI 도구를 쓰라고 돌려보낸다.
 *   1) 보호 폴더 — 플러그인 설정 protected_dirs, 그리고 원문 결과 폴더(raw_dir, 기본 ~/Documents/HAI 원문)
 *   2) 이 플러그인이 만든 원문 파일 — 받아쓰기·OCR 결과, 실명으로 되돌린 결과물 (~/.hai-mcp/raw-files.log 장부, 지금 있는 파일만)
 *   3) ~/.hai-mcp/tmp (변환 중인 음성 — 직접 가리킬 때만, 이름·상위 폴더 검사에는 넣지 않는다: "tmp" 는 흔한 이름이다)
 * 경로는 NFC 로 맞추고, macOS·Windows 에서는 대소문자를 가리지 않는다(파일 시스템이 그렇다).
 * Bash 는 명령 글자를 보고 판단하는 최선 노력이다:
 *   - 원문 파일 이름·보호 폴더 경로가 명령 어디에든(따옴표·heredoc·python 안이라도) 보이면 막는다
 *   - 경로 단어가 보호 대상 안이거나, 보호 대상을 품은 상위 폴더를 재귀로 훑으면 막는다
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// Windows: 안에서는 모든 경로를 Git Bash 꼴(/c/users/…)로 맞춰 비교한다 — C:\x · C:/x · /c/x · /cygdrive/c/x 가 모두 같은 곳.
// 파일 시스템에 물을 때만 원래 꼴(C:\x)로 되돌린다. macOS·Linux 는 그대로
const WIN = os.platform() === 'win32';
const P = WIN ? path.posix : path;
const toP = (p) => (!WIN ? String(p) : String(p).replace(/^\\\\\?\\/, '').replace(/\\/g, '/')
  .replace(/^([A-Za-z]):(?=\/|$)/, (_, d) => `/${d.toLowerCase()}`).replace(/^\/cygdrive\/([a-zA-Z])(?=\/|$)/, (_, d) => `/${d.toLowerCase()}`));
const toN = (p) => { if (!WIN) return p; const m = p.match(/^\/([a-zA-Z])(\/.*)?$/); return m ? `${m[1].toUpperCase()}:${(m[2] || '/').replace(/\//g, '\\')}` : p; };
const exists = (p) => { try { return fs.existsSync(toN(p)); } catch { return false; } };
const HOME = toP(os.homedir());
const DATA = toP(process.env.HAI_DATA_DIR || path.join(os.homedir(), '.hai-mcp'));
const FOLD = os.platform() === 'darwin' || WIN;
// 실제 문서 폴더(Windows 는 OneDrive 로 옮겨졌을 수 있다) — 서버가 dataDir/docs-dir 에 적어 둔다
const DOCS = (() => { try { return toP(fs.readFileSync(toN(P.join(DATA, 'docs-dir')), 'utf8').trim()) || P.join(HOME, 'Documents'); } catch { return P.join(HOME, 'Documents'); } })();
const fold = (s) => { const n = String(s).normalize('NFC'); return FOLD ? n.toLowerCase() : n; };
const norm = (p) => fold(P.resolve(toP(p)));
/** 환경 변수 참조($env:X · %X% · ${env:X})를 값으로 — Windows 셸(PowerShell·cmd)에서 쓰는 꼴 */
const envRefs = (s) => (!WIN ? s : s.replace(/\$\{env:([A-Za-z_]\w*)\}|\$env:([A-Za-z_]\w*)|%([A-Za-z_]\w*)%/gi, (all, a, b, c) => { const v = process.env[a ?? b ?? c]; return v ? toP(v) : all; }));
const expand = (p, cwd = process.cwd()) => {
  let s = envRefs(String(p)).replace(/^\$HOME(?=[/\\]|$)/i, HOME).replace(/^\$\{HOME\}(?=[/\\]|$)/, HOME);
  s = toP(s);
  return P.resolve(toP(cwd), s.startsWith('~') ? P.join(HOME, s.slice(1)) : s);
};
// 실제 경로(심볼릭 링크·Windows 짧은 이름 RUNNER~1 풀기). 아직 없는 파일이면 있는 상위 폴더까지 풀고 나머지를 붙인다
const real = (p) => {
  const rp = (x) => toP(WIN ? fs.realpathSync.native(toN(x)) : fs.realpathSync(x));
  try { return rp(p); } catch { /* 없음 */ }
  let dir = p, rest = '';
  for (let i = 0; i < 64 && dir !== P.dirname(dir); i++) {
    rest = rest ? P.join(P.basename(dir), rest) : P.basename(dir);
    dir = P.dirname(dir);
    try { return P.join(rp(dir), rest); } catch { /* 더 위로 */ }
  }
  return p;
};
const key = (p) => norm(real(p));
const tilde = (p) => (fold(p).startsWith(fold(HOME)) ? `~${p.slice(HOME.length)}` : p);
/** 명령·파일 이름 — Windows 는 .exe 를 떼고 대소문자를 가리지 않는다 (C:\Program Files\Git\usr\bin\grep.exe → grep) */
const bn = (w) => (WIN ? P.basename(toP(w)).replace(/\.exe$/i, '').toLowerCase() : path.basename(w));
/** 명령 글자 전체를 비교용 꼴로 — Windows 는 환경 변수를 풀고 C:\ · \ 를 /c/ · / 로 */
const canonText = (s) => fold(!WIN ? s : envRefs(s)
  .replace(/\[(System\.)?Environment\]::GetFolderPath\(\s*['"]?(\[Environment\+SpecialFolder\]::)?(MyDocuments|Personal)['"]?\s*\)/gi, DOCS)
  .replace(/\$HOME\b|\$\{HOME\}/gi, HOME).replace(/\\\\\?\\/g, '').replace(/\\/g, '/')
  .replace(/\/\/(localhost|127\.0\.0\.1)\/([A-Za-z])\$(?=\/|$)/gi, (_, h, d) => `${d}:/`)
  .replace(/(^|[^A-Za-z0-9_])([A-Za-z]):\//g, (_, pre, d) => `${pre}/${d.toLowerCase()}/`));

const opt = process.env.CLAUDE_PLUGIN_OPTION_PROTECTED_DIRS ?? '';
// 원문 결과 폴더(받아쓰기·OCR 기본 저장 곳)도 보호 폴더처럼 — 설정이 없으면 서버가 정한 곳(raw-dir 파일, Windows 의 OneDrive 문서 폴더 등), 그것도 없으면 기본값. HAI_RAW_DIR 은 시험용
const rawOpt = process.env.HAI_RAW_DIR ?? process.env.CLAUDE_PLUGIN_OPTION_RAW_DIR ?? '';
const rawSaved = (() => { try { return fs.readFileSync(toN(P.join(DATA, 'raw-dir')), 'utf8').trim(); } catch { return ''; } })();
const rawDir = rawOpt && !rawOpt.includes('${') ? rawOpt : rawSaved || P.join(HOME, 'Documents', 'HAI 원문');
const userDirs = [...(opt.includes('${') ? [] : opt.split(',').map((s) => s.trim()).filter(Boolean)).map((d) => [d, false]), ...(exists(expand(rawDir)) ? [[rawDir, true]] : [])]
  // rawdir: 원문 결과 폴더 — 파일 이름은 Claude 가 만든 것이라 이름만 보는 명령(ls·open·find·Glob)은 괜찮고, 내용 읽기만 막는다
  .map(([d, rawdir]) => { const p = real(expand(d)); return { shown: tilde(p), key: norm(p), dir: true, rawdir, forms: [fold(p), fold(tilde(p))] }; });
const internal = { shown: '~/.hai-mcp/tmp', key: key(P.join(DATA, 'tmp')), dir: true, internal: true };
let raws = [];
try {
  raws = [...new Set(fs.readFileSync(toN(P.join(DATA, 'raw-files.log')), 'utf8').split(/\r?\n/).filter(Boolean))]
    .filter((f) => fs.existsSync(f)) // 지운 파일 때문에 그 폴더 검색이 계속 막히지 않게
    .map((f) => ({ shown: tilde(toP(f)), key: key(toP(f)), dir: false, base: fold(P.basename(toP(f))) }));
} catch { /* 없음 */ }
const targets = [...userDirs, internal, ...raws];
const watched = [...userDirs, ...raws]; // 상위 폴더 검사 대상(내부 tmp 제외)
const guarded = () => userDirs.length > 0 || raws.length > 0;

const inside = (p, dir) => { const rel = P.relative(dir, p); return rel === '' || (!rel.startsWith('..') && !P.isAbsolute(rel)); };
/** p(정규화)가 보호 대상 안이면 그 대상 */
const hit = (p) => targets.find((t) => (t.dir ? inside(p, t.key) : p === t.key));
/** p 가 보호 대상을 품은 상위 폴더면 그 대상 */
const ancestorOf = (p) => watched.find((t) => t.key !== p && inside(t.key, p));
/** 이름만 보는 검색용 — 원문 파일은 이름을 Claude 가 이미 알고(자기가 만들었다) 내용이 나가지 않으니 보호 폴더만 */
const ancestorDirOf = (p) => userDirs.find((t) => !t.rawdir && t.key !== p && inside(t.key, p));

function deny(t, why, { scope = false } = {}) {
  const what = t.dir ? `${t.shown} 은 보호 폴더입니다` : `${t.shown} 은 HAI 가 만든 원문 파일입니다(실명·받아쓰기 원문)`;
  const next = scope
    ? '보호 폴더 밖의 더 좁은 폴더를 지정해서 다시 하세요(예: ~/Documents/계약). 보호 폴더 안의 내용이 필요하면 hai_search·hai_ask_files 를 쓰세요.'
    : '원본을 직접 열지 말고 hai_ask_file(HAI 만 읽고 답) 또는 hai_mask_file(가려서 읽기)을 쓰세요. 원문 파일 확인은 사용자가 직접 합니다.';
  process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: `${what} — ${why}. ${next}` } }));
  process.exit(0);
}

// 여러 폴더를 훑는 명령만 — grep·cp 계열의 -r/-R, ls -R, find·rg·tar·zip, 하위로 내려가는 와일드카드(*/ · **/ · /**).
// ls -lrt · sort -r 처럼 r 이 "역순"인 옵션은 아니다. 마크다운 **굵게** 도 아니다
/**
 * 명령 하나(첫 단어 + 인자)가 하위 폴더를 훑나 → 'content'(내용까지 읽음) | 'names'(이름만) | null.
 * 명령 글자 전체가 아니라 명령 자리의 첫 단어로 본다 — 커밋 메시지 속 "find"·CSS 주석 속 별표-빗금에 걸리지 않게
 */
/**
 * 앞에 붙은 감싸는 말을 벗긴다 — LC_ALL=C grep …, time rg …, sudo -u x zip …, env A=1 find …, timeout 5 grep …, ls | xargs -I{} rg …
 * 이걸 안 하면 진짜 명령(grep -r)을 못 보고 통과시킨다
 */
const WRAPPERS = { time: [], sudo: ['-u', '-g', '-h', '-p', '-C'], doas: ['-u'], command: [], builtin: [], exec: ['-a'], nohup: [], env: ['-u', '-S', '-C'],
  nice: ['-n'], ionice: ['-c', '-n', '-p'], timeout: ['-s', '-k', '--signal', '--kill-after'], stdbuf: ['-i', '-o', '-e'], caffeinate: ['-t', '-w'],
  xargs: ['-I', '-i', '-n', '-P', '-L', '-l', '-s', '-d', '-E', '-a'], unbuffer: [], chronic: [], gtimeout: ['-s', '-k'],
  taskset: ['-c', '-p'], chrt: ['-p'], flock: ['-w', '-E', '-c'], parallel: ['-j', '-S'], nocache: [], torsocks: [] };
function unwrap(ws) {
  let i = 0;
  for (let guard = 0; guard < 20 && i < ws.length; guard++) {
    const w = unq(ws[i]);
    if (/^[A-Za-z_]\w*=/.test(w)) { i++; continue; }           // LC_ALL=C
    const c = bn(w);
    if (!(c in WRAPPERS)) break;
    i++;
    const withArg = WRAPPERS[c];
    while (i < ws.length && unq(ws[i]).startsWith('-')) { const o = unq(ws[i]); i += withArg.includes(o) ? 2 : 1; } // 옵션(값 받는 것은 값까지)
    if (c === 'env') while (i < ws.length && /^[A-Za-z_]\w*=/.test(unq(ws[i]))) i++;
    if (/^g?timeout$/.test(c) && i < ws.length && /^\d/.test(unq(ws[i]))) i++;  // timeout 10 grep …
    if (c === 'taskset' && i < ws.length && /^(0x)?[\da-f,-]+$/i.test(unq(ws[i]))) i++;  // taskset 0x1 grep …
    if (c === 'chrt' && i < ws.length && /^\d+$/.test(unq(ws[i]))) i++;
    if (c === 'flock' && i < ws.length) i++;                                     // flock 잠금파일 grep …
  }
  return ws.slice(i);
}

function recursionOf(raw) {
  const ws = unwrap(raw);
  const c = bn(unq(ws[0] ?? ''));
  const has = (re) => ws.slice(1).some((w) => re.test(w));
  const R = /^(-[a-zA-Z]*[rR][a-zA-Z]*|--recursive)$/;
  if (/^(grep|egrep|fgrep|zgrep)$/.test(c) && has(R)) return 'content';
  if (/^(cp|scp)$/.test(c) && has(/^(-[a-zA-Z]*[rRa][a-zA-Z]*|--recursive|--archive)$/)) return 'content'; // cp -a 는 -R 을 품는다
  if (c === 'rsync' && has(/^(-[a-zA-Z]*[raR][a-zA-Z]*|--recursive|--archive)$/)) return 'content';
  if (c === 'tar') { // 만들기·덧붙이기만 폴더를 읽는다 — 목록 보기(t)·풀기(x)는 압축 파일 하나만
    const key = ws.slice(1).find((w) => !w.startsWith('--')) ?? '';
    const create = ws.slice(1).some((w) => /^--(create|append|update)$/.test(w)) || /^-?[a-zA-Z]*[cru]/.test(key);
    return create ? 'content' : null;
  }
  if (/^(rg|ag|ack|zip|7z|ditto)$/.test(c)) return 'content';
  if (c === 'find') return has(/^(-exec|-execdir|-ok|-okdir|-delete)$/) ? 'content' : 'names';
  if (c === 'tree') return 'names'; // du 는 크기만 본다
  if (c === 'ls' && has(/^-[a-zA-Z]*R/)) return 'names';
  return null;
}
/** 셸 와일드카드(*, ?) → 정규식 (한 폴더 안 이름만) */
function globRe(g) {
  let re = '';
  for (let i = 0; i < g.length; i++) {
    const c = g[i];
    if (c === '*') re += '[^/]*';
    else if (c === '?') re += '[^/]';
    else if (c === '[') { const j = g.indexOf(']', i + 2); if (j > 0) { re += `[${g.slice(i + 1, j).replace(/^!/, '^').replace(/\\/g, '\\\\')}]`; i = j; } else re += '\\['; }
    else re += c.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  }
  try { return new RegExp(`^${re}$`, FOLD ? 'iu' : 'u'); } catch { return /^$/; }
}
// 경로를 글자로 숨길 수 있는 형태: \x·\u·8진 이스케이프, eval, base64·xxd·uudecode 풀기
// 경로를 글자로 숨길 수 있는 명령(명령 자리의 첫 단어로 본다): eval, base64·xxd·uudecode·openssl 풀기
// 셸 설정에 흔한 eval "$(…)" — 내용이 정해진 도구들이라 경로를 숨길 수 없다
const SAFE_EVAL = /^\$\(\s*(\S*\/)?(brew shellenv|(py|rb|nod|go)env init -?|pyenv virtualenv-init -|conda shell\.\w+ hook|direnv hook \w+|ssh-agent( -s)?|fnm env[^()]*|zoxide init \w+|starship init \w+|mise activate \w+|rtx activate \w+)\s*\)$/;
function opaque(raw) {
  const ws = unwrap(raw);
  const c = bn(unq(ws[0] ?? ''));
  if (c === 'eval' && ws.length === 2 && SAFE_EVAL.test(unq(ws[1]))) return false;
  const has = (re) => ws.slice(1).some((w) => re.test(w));
  return c === 'eval' || c === 'uudecode' || (c === 'base64' && has(/^(-d|-D|--decode)$/)) || (c === 'xxd' && has(/^-r/)) || (c === 'openssl' && has(/^(enc|base64)$/));
}
// 명령 치환 안에서 만든 글자(\x·\u·8진 이스케이프) — printf '\xec…' 로 경로를 만들 수 있다
const ENCODED = /\\x[0-9a-fA-F]{1,2}|\\u[0-9a-fA-F]{2,4}|\\U[0-9a-fA-F]{4,8}|\\[0-3][0-7]{2}/;
// 내용을 읽지 않고 이름·속성만 보거나 사용자에게 여는 명령
const NAMES_ONLY = new Set(['ls', 'stat', 'du', 'df', 'file', 'echo', 'pwd', 'mkdir', 'touch', 'open', 'which', 'cd', 'xattr', 'mdls']);


/**
 * 셸처럼 단어로 나눈다 — 작은따옴표·큰따옴표·\ 이스케이프를 풀고, 붙어 있는 따옴표 조각은 한 단어로 잇는다(인''사 → 인사).
 * ; & | < > ( ) ` 와 공백은 단어를 끊는다($(…) 안도 단어가 된다). 최선 노력 — 셸 전체를 흉내 내지는 않는다
 */
const QUOTED = { '*': '\uE001', '?': '\uE002', '[': '\uE003', '{': '\uE004' };
const UNQUOTE = Object.fromEntries(Object.entries(QUOTED).map(([a, b]) => [b, a]));
const lit = (s) => s.replace(/[*?[{]/g, (c) => QUOTED[c]);      // 따옴표 안 → 와일드카드 아님
const unq = (s) => s.replace(/[\uE001-\uE004]/g, (c) => UNQUOTE[c]); // 원래 글자로

const SEP = '\u0000SEP';
/** 따옴표 밖의 ; & | 줄바꿈 ` $( ) 에서 명령을 나눈다 → [[단어…], …] (따옴표 안의 ; 는 나누지 않는다) */
function shellCommands(cmd, depth = 0) {
  const out = [[]];
  const inner = [];
  for (const w of shellWords(cmd, true, inner)) { if (w === SEP) { if (out.at(-1).length) out.push([]); } else out.at(-1).push(w); }
  // 큰따옴표 안의 $(…)·`…` 는 bash 가 실행한다 — 따로 명령으로(작은따옴표 안은 글자)
  if (depth < 4) for (const x of inner) out.push(...shellCommands(x, depth + 1));
  return out.filter((c) => c.length);
}

/** 큰따옴표 안 i 위치의 $( 에서 짝 ) 까지 → [안쪽 글자, 끝 다음 위치] */
function matchParen(cmd, i) {
  let d = 0, j = i;
  for (; j < cmd.length; j++) {
    const c = cmd[j];
    if (c === '\\') { j++; continue; }
    if (c === "'" ) { const k = cmd.indexOf("'", j + 1); if (k < 0) break; j = k; continue; }
    if (c === '(') d++;
    else if (c === ')' && --d === 0) return [cmd.slice(i + 1, j), j + 1];
  }
  return [cmd.slice(i + 1), cmd.length];
}

function shellWords(cmd, ops = false, inner = null) {
  const out = [];
  let cur = '', has = false;
  const push = () => { if (has) out.push(cur); cur = ''; has = false; };
  const sep = () => { push(); if (ops) out.push(SEP); };
  for (let i = 0; i < cmd.length;) {
    const c = cmd[i];
    if (c === '\\') { if (cmd[i + 1] !== '\n' && i + 1 < cmd.length) { cur += cmd[i + 1]; has = true; } i += 2; continue; }
    if (c === '$' && cmd[i + 1] === "'") { // $'\xec\x9d\xb8' — bash 처럼 풀어서 본다
      let j = i + 2, bytes = [];
      const flush = () => { if (bytes.length) { cur += Buffer.from(bytes).toString('utf8'); bytes = []; } };
      while (j < cmd.length && cmd[j] !== "'") {
        let m;
        const rest = cmd.slice(j);
        if ((m = rest.match(/^\\x([0-9a-fA-F]{1,2})/))) { bytes.push(parseInt(m[1], 16)); j += m[0].length; continue; }
        if ((m = rest.match(/^\\([0-7]{1,3})/))) { bytes.push(parseInt(m[1], 8) & 255); j += m[0].length; continue; }
        flush();
        if ((m = rest.match(/^\\u([0-9a-fA-F]{1,4})|^\\U([0-9a-fA-F]{1,8})/))) { cur += String.fromCodePoint(parseInt(m[1] ?? m[2], 16)); j += m[0].length; continue; }
        if ((m = rest.match(/^\\(.)/s))) { cur += ({ n: '\n', t: '\t', r: '\r', a: '', b: '', e: '', f: '', v: '' })[m[1]] ?? m[1]; j += 2; continue; }
        cur += cmd[j]; j++;
      }
      flush(); has = true; i = j + 1; continue;
    }
    if (c === "'") { const j = cmd.indexOf("'", i + 1); const e = j < 0 ? cmd.length : j; cur += lit(cmd.slice(i + 1, e)); has = true; i = e + 1; continue; }
    if (c === '"') {
      let j = i + 1;
      while (j < cmd.length && cmd[j] !== '"') {
        if (cmd[j] === '\\' && /["\\$`]/.test(cmd[j + 1] ?? '')) { cur += cmd[j + 1]; j += 2; continue; }
        if (cmd[j] === '$' && cmd[j + 1] === '(') { const [txt, e] = matchParen(cmd, j + 1); inner?.push(txt); cur += lit(`$(${txt})`); j = e; continue; }
        if (cmd[j] === '`') { const e = cmd.indexOf('`', j + 1); const txt = cmd.slice(j + 1, e < 0 ? cmd.length : e); inner?.push(txt); cur += lit(`\`${txt}\``); j = e < 0 ? cmd.length : e + 1; continue; }
        cur += lit(cmd[j]); j++;
      }
      has = true; i = j + 1; continue;
    }
    if (c === '#' && !has) { const e = cmd.indexOf('\n', i); i = e < 0 ? cmd.length : e; continue; } // 주석 — 안의 ' 가 뒤 명령을 삼키지 않게
    if (c === '\n' || ';&|()`'.includes(c)) { sep(); i++; continue; }
    if (/\s/.test(c) || '<>'.includes(c)) { push(); i++; continue; }
    if (c === '$' && cmd[i + 1] === '(') { sep(); i += 2; continue; }
    cur += c; has = true; i++;
  }
  push();
  return out;
}

/** heredoc 본문을 떼어 낸다 → { shell: 본문 뺀 명령, bodies: [본문] } — 본문은 셸이 펼치지 않는 글자(따옴표 안처럼 본다) */
function splitHeredocs(cmd) {
  const lines = cmd.split('\n');
  const shell = [], bodies = [];
  let pending = [];
  let body = null;
  for (const line of lines) {
    if (body) {
      const d = pending[0];
      if (line.replace(d.strip ? /^\t+/ : /^$/, '') === d.tag) { bodies.push(body.join('\n')); body = null; pending.shift(); if (pending.length) body = []; continue; }
      body.push(line);
      continue;
    }
    shell.push(line);
    for (const m of line.matchAll(/<<(-?)\s*(['"]?)([A-Za-z_][\w.-]*)\2/g)) pending.push({ tag: m[3], strip: m[1] === '-' });
    if (pending.length) body = [];
  }
  if (body?.length) bodies.push(body.join('\n'));
  return { shell: shell.join('\n'), bodies };
}

/** {a,b} 펼치기 — 펼치는 중에 64개에서 멈춘다(그룹이 많아도 지수로 늘지 않게). 넘치면 truncated */
const BRACE_MAX = 64;
function braces(w) {
  let list = [w], truncated = false;
  for (let guard = 0; guard < 32; guard++) {
    const next = [];
    let changed = false;
    for (const x of list) {
      const m = x.match(/^(.*?)\{([^{}]*,[^{}]*)\}(.*)$/s);
      if (!m) { next.push(x); continue; }
      changed = true;
      for (const alt of m[2].split(',')) { if (next.length >= BRACE_MAX) { truncated = true; break; } next.push(m[1] + alt + m[3]); }
      if (truncated) break;
    }
    list = next;
    if (!changed || truncated) break;
  }
  braces.truncated = truncated;
  return list;
}

/**
 * 와일드카드(* ? [..] **)·중괄호가 든 경로를 보호 대상과 직접 맞춰 본다 — 폴더를 훑지 않으니 아무리 넓은 패턴도 빠르고(시간 초과로 통과되지 않음),
 * 개수 상한에 잘려 놓치는 일도 없다. → [{ t: 대상, rel: 'equal'(대상 자체) | 'inside'(보호 폴더 안) | 'ancestor'(대상을 품은 상위) }]
 */
function globTargets(word, base) {
  const out = [];
  const all = braces(word);
  if (braces.truncated && guarded()) throw Object.assign(new Error('braces'), { tooMany: true });
  for (const w of all) {
    let segs = fold(expand(w, base)).split('/').filter(Boolean);
    // 와일드카드 앞의 고정된 부분은 실제 경로(심볼릭 링크 풀기)로 — 대상 키가 realpath 다
    const k = segs.findIndex((x) => /[*?[]/.test(x));
    if (k > 0) {
      const head = fold(real('/' + segs.slice(0, k).join('/'))).split('/').filter(Boolean);
      segs = [...head, ...segs.slice(k)];
    }
    const res = segs.map((x) => (x === '**' ? '**' : /[*?[]/.test(x) ? globRe(x) : x));
    for (const t of targets) {
      const ts = t.key.split('/').filter(Boolean);
      const rel = relate(res, ts);
      if (rel) out.push({ t, rel });
    }
  }
  return out;
}
/** 패턴 조각들과 대상 경로 조각들의 관계. ** 는 0개 이상의 아무 조각. (i, j) 를 기억해 ** 가 여럿이어도 조각 수의 곱 이내로 끝난다 */
function relate(ps, ts) {
  const memo = new Map();
  const go = (i, j) => {
    const k = i * (ts.length + 1) + j;
    if (memo.has(k)) return memo.get(k);
    let r;
    if (i === ps.length) r = j === ts.length ? 'equal' : 'ancestor';
    else if (ps[i] === '**') r = go(i + 1, j) || (j < ts.length ? go(i, j + 1) : null) || 'ancestor';
    else if (j === ts.length) r = 'inside';
    else r = (typeof ps[i] === 'string' ? ps[i] === ts[j] : ps[i].test(ts[j])) ? go(i + 1, j + 1) : null;
    memo.set(k, r);
    return r;
  };
  return go(0, 0);
}

/**
 * 글자 x 의 i 자리에서 경로 f 가 끝나나 — 뒤가 빗금·따옴표·공백 등. 공백 뒤로 글자가 이어지고 그렇게 이은 이름이 실제로 있으면(인사 → "인사 자료") 다른 폴더다
 */
/** 글자 x 의 i 자리가 (그 줄에서) 따옴표 안인가 */
function inQuotes(x, i) {
  let q = null;
  for (let k = x.lastIndexOf('\n', i - 1) + 1; k < i; k++) {
    const c = x[k];
    if (q) { if (c === q) q = null; } else if (c === "'" || c === '"') q = c;
  }
  return q !== null;
}
function endsAt(x, i, f) {
  const after = x.slice(i + f.length);
  if (!/^($|[/\s"'`)\]},;|])/.test(after)) return false;
  // 이어진 이름 예외는 따옴표 안에서만 — 따옴표 밖 공백은 셸이 단어를 끊으므로(cat …/인사 자료 → …/인사 와 자료) 예외로 두면 피해 갈 수 있다
  if (inQuotes(x, i) && /^[ \t]+[^\s/"'`;|,()]/.test(after)) {
    const ext = after.match(/^[^"'`;|,()\n/\\]*/)[0].replace(/\s+$/, '');
    if (exists(f + ext)) return false;
  }
  return true;
}

/** 보호 폴더 d 를 품은 상위 폴더들(홈 폴더까지) — 이 중 하나를 하위까지 훑으면 d 에 닿는다 */
function ancestorsOf(d) {
  const out = [];
  const home = fold(HOME);
  for (let p = P.dirname(d.key); p !== P.dirname(p); p = P.dirname(p)) { out.push(p); if (p === home) break; }
  return out;
}
const escRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const quotedIs = (txt, name) => new RegExp(`(['"])\\s*${escRe(name)}[/\\\\]?\\s*\\1`).test(txt);
// 코드에서 홈 폴더를 가리키는 말
const HOME_REF = /expanduser\(\s*(['"])~\1|path\.home\(\)|homedir\(\)|\$env:userprofile|%userprofile%|\$home\b|\$\{home\}|getfolderpath|userprofile|(['"])~\2/i;
// 경로를 위로 올리는 표현 — 변수에 담았다 다음 줄에서 올라가도 같은 코드 안이다
const UP_RE = /(^|[/\\'"\s])\.\.([/\\'"\s)]|$)|\.parents?\b|dirname\s*\(|split-path\b[^\n]*-parent|\.directory\b|getparent|path\.resolve\([^)]*\.\./i;
// 작업 폴더 기준으로 훑는 코드
const REL_WALK = /os\.walk\(\s*(['"]\.{0,2}[/\\]?['"]|os\.getcwd\(\)|os\.curdir)|path\(\s*(['"]\.?['"])?\s*\)\s*\.(rglob|glob|walk)|path\.cwd\(\)|\b(i?glob|glob\.glob)\(\s*r?['"](\*\*|\.[/\\])|walkdir\(\s*['"]\.|readdirsync\(\s*['"]\.|filepath\.walk\(\s*"\./i;
// 하위 폴더까지 훑는 코드
const WALK = /rglob|os\.walk|\bwalk\(|walkdir|recursive\s*=\s*true|\*\*[/\\]|[/\\]\*\*|readdirsync\([^)]*recursive|filepath\.walk|files\.walk|dir\.glob/i;

/**
 * 코드(스크립트 파일·인라인 코드·PowerShell)가 경로를 조각으로 잇거나 상위 폴더를 하위까지 훑어 보호 폴더에 닿나.
 *  - 따옴표 안 글자가 보호 폴더 이름('인사')인데 같은 코드가 그 상위(홈·'Documents'·상위 경로)도 가리킬 때 — os.path.join(home, 'Documents', '인사')
 *    (상위를 가리키지 않으면 그냥 낱말이다: df['부서'] == '인사' · git commit -m '인사')
 *  - 상위 폴더(또는 작업 폴더가 상위일 때 그 아래)를 하위까지 훑는 코드 — Path.home().rglob('*.txt')
 */
function codeCheck(txt, where, cwds = []) {
  const raw = fold(txt);
  const T = [...new Set([raw, canonText(txt)])];
  const walk = WALK.test(raw);
  // 작업 폴더(cd 로 옮긴 곳 포함)가 보호 폴더의 상위면 코드 속 '인사' · os.walk('.') 는 그 아래를 가리킨다
  const cwdKeys = [].concat(cwds).filter(Boolean).map((c) => key(c));
  for (const d of userDirs) {
    const ancs = ancestorsOf(d);
    const named = ancs.some((a) => {
      // 상위 경로가 거기서 끝나거나 보호 폴더 쪽(또는 와일드카드)으로 이어질 때만 — ~/Desktop/** 는 홈이 아니라 Desktop 이다
      const toward = (x, i, f) => {
        // 적힌 경로를 끝까지 따라간다 — 따옴표 안이면 따옴표까지(띄어쓰기 든 폴더), 밖이면 공백까지
        const rest = x.slice(i + f.length).match(inQuotes(x, i) ? /^[^"'`\n]*/ : /^[^"'`\n\s]*/)[0];
        if (f === '~' && !rest) return false; // 홈 그대로('~')는 아래 홈 표현 검사가 맡는다
        // .·.. 를 풀고 와일드카드 앞까지 — 그 경로가 보호 폴더이거나 그 상위(그 아래를 훑을 수 있다)면 보호 폴더 쪽
        const segs = rest.split(/[/\\]+/).filter(Boolean);
        const w = segs.findIndex((x) => /[*?[]/.test(x));
        const fixed = P.normalize(`${a}/${(w >= 0 ? segs.slice(0, w) : segs).map((x) => fold(x).replace(/\s+$/, '')).join('/')}`).replace(/(.)\/+$/, '$1');
        return fixed === d.key || ancs.includes(fixed) || fixed.startsWith(`${d.key}/`);
      };
      for (const f of [a, fold(tilde(a))]) for (const x of T) for (let i = x.indexOf(f); i >= 0; i = x.indexOf(f, i + 1)) if (endsAt(x, i, f) && toward(x, i, f)) return true;
      const b = P.basename(a);
      return b.length >= 2 && quotedIs(raw, b);
    });
    // 홈 표현마다 — 바로 뒤에 다른 폴더를 붙였으면(Path.home() / 'Desktop' · join(expanduser('~'), 'Desktop')) 그 폴더다. 하나라도 홈 그대로면 홈
    const homeRef = d.key.startsWith(`${fold(HOME)}/`) && [...raw.matchAll(new RegExp(HOME_REF.source, 'gi'))].some((m) => {
      const j = raw.slice(m.index + m[0].length).match(/^\s*\)?\s*(?:\/|,)\s*(['"])([^'"\n]+)\1/);
      if (!j) return true;
      // 코드 어디에서든 위로 올라가는 표현이 있으면(.. · .parent · dirname · Split-Path -Parent) 붙인 폴더에 머문다고 볼 수 없다 — 홈이다
      if (UP_RE.test(raw)) return true;
      const sub = norm(P.join(HOME, j[2].split(/[/\\]/)[0]));
      return sub === d.key || ancs.includes(sub);
    });
    const b = P.basename(d.key);
    // 작업 폴더가 바로 위 폴더면 '인사' 는 그 폴더다. 더 위(홈)에서는 흔한 낱말일 수 있어 상위를 함께 가리킬 때만
    const inParent = cwdKeys.includes(P.dirname(d.key));
    if (b.length >= 2 && quotedIs(raw, b) && (named || homeRef || inParent)) deny(d, `${where}에 그 폴더 이름이 경로 조각으로 들어 있음`);
    // 작업 폴더 기준으로 훑는 코드(절대 경로 없이 os.walk('.') 등)는 작업 폴더가 상위일 때
    // 작업 폴더를 훑는 꼴(os.walk('.') · Path().rglob · Path.cwd() · glob('**…'))이 있으면 다른 절대 경로가 함께 있어도 그 꼴로 본다
    const relWalk = REL_WALK.test(raw) || !/(['"])\s*(\/|~|[a-z]:[\\/])/i.test(raw);
    const inAnc = relWalk && cwdKeys.some((c) => ancs.includes(c));
    // 홈을 훑는 코드는 다른 폴더 이름이 함께 보여도 막는다(그 이름은 코드가 마음대로 넣을 수 있다) — 좁히려면 경로를 그대로 적는다
    if (walk && (named || homeRef || inAnc)) deny(d, `${where}가 하위 폴더까지 훑는데 그 아래에 보호 폴더가 있음. 훑을 폴더를 전체 경로로 적어 주세요`, { scope: true });
  }
}

/** 글자에 원문 파일 이름·보호 폴더 경로·경로 속 보호 폴더 이름이 보이면 막는다. names: 이름만 보는 명령이면 원문 결과 폴더·원문 파일은 넘어간다 */
function textCheck(txt, { names = false, where = '명령' } = {}) {
  const T = [...new Set([fold(txt), canonText(txt)])];
  if (!names) for (const r of raws) if (r.base.length >= 4 && T.some((x) => x.includes(r.base))) deny(r, `${where}에 그 파일 이름이 들어 있음`);
  for (const d of userDirs) {
    if (names && d.rawdir) continue;
    for (const f of d.forms) for (const x of T) {
      for (let i = x.indexOf(f); i >= 0; i = x.indexOf(f, i + 1)) if (endsAt(x, i, f)) deny(d, `${where}에 그 폴더 경로가 들어 있음`);
    }
    const b = P.basename(d.key);
    if (b.length < 2) continue;
    // 경로 조각 속 폴더 이름(…/인사/… · 'Documents\인사') — 바로 위 폴더 안에 "인사 자료" 처럼 이어진 이름이 실제로 있으면 그쪽
    const B = escRe(b), E = String.raw`\s"'\`,;|()<>=/\\`;
    const re = new RegExp(`(?:^|[${E}])${B}(?=[/\\\\])|[/\\\\]${B}(?=$|[${E}])`, 'g');
    const sib = P.dirname(d.key) + '/' + b;
    for (const x of T) for (const m of x.matchAll(re)) {
      const at = m.index + m[0].length - b.length;
      const ext = x.slice(at + b.length).match(/^[ \t]+[^\s/"'`;|,()\\][^"'`;|,()\n/\\]*/)?.[0].replace(/\s+$/, '');
      if (!(ext && exists(sib + ext))) deny(d, `${where}에 그 폴더 이름이 경로로 들어 있음`);
    }
  }
}

// 코드를 실행하는 프로그램(명령 자리에 올 때만) — 이걸로 스크립트 파일을 돌리면 그 파일 내용도 본다
const INTERP = /^(python[\d.]*|pythonw|py|node|nodejs|deno|bun|tsx|ts-node|ruby|perl|php|rscript|bash|sh|zsh|dash|ksh|fish|pwsh|powershell|cscript|wscript|cmd|julia|lua|osascript|swift|java|go|dotnet)$/i;
const SCRIPT_EXT = /\.(py|pyw|ipynb|ps1|psm1|js|mjs|cjs|ts|rb|pl|php|r|sh|bash|zsh|bat|cmd|vbs|jl|lua|swift|java|go|cs|sql)$/i;
/** 명령(단어 목록)이 코드를 실행하나 */
// 이름을 말하기만 하는 명령 — 그 인자의 python 은 실행이 아니다(echo python · which node · git commit -m "python …")
const DESCRIBE = /^(echo|printf|which|whereis|type|man|whatis|git|write-output|write-host|get-command|gcm|get-help|help)$/i;
function runsCode(ws) {
  const h = ws[0] ?? '';
  if (/^(source|\.|&)$/.test(h) || SCRIPT_EXT.test(h)) return true;
  const nm = (w) => bn(w).replace(/\.exe$/i, '');
  if (DESCRIBE.test(nm(h))) return false;
  return ws.some((w) => INTERP.test(nm(w))); // find … -exec python a.py · xargs node · nice python …
}
/** 실행하는 스크립트 파일(python a.py · python -m a · ./a.sh · & .\a.ps1)의 내용에 보호 대상이 있으면 막는다 — Claude 가 스크립트를 써서 돌리는 경우 */
function scriptCheck(ws, bases) {
  if (!runsCode(ws)) return;
  const files = ws.filter((w) => SCRIPT_EXT.test(w));
  ws.forEach((w, i) => { if (w === '-m' && ws[i + 1]) files.push(`${ws[i + 1].replace(/\./g, '/')}.py`, `${ws[i + 1].replace(/\./g, '/')}/__main__.py`); });
  for (const w of files) for (const b of bases) {
    const f = toN(expand(w, b));
    let st;
    try { st = fs.statSync(f); } catch { continue; }
    if (!st.isFile() || st.size > 2_000_000) continue;
    const body = fs.readFileSync(f, 'utf8').normalize('NFC');
    const where = `실행하는 스크립트(${P.basename(toP(f))})`;
    textCheck(body, { where });
    codeCheck(body, where, bases);
  }
}

// ── PowerShell (Windows 에서 Git Bash 가 없으면 Claude 가 쓰는 셸) ──
// 이름·속성만 보거나 사용자 앱으로 여는 것 — 명령이 모두 이것뿐이면 "이름만 보기"(원문 결과 폴더·원문 파일 이름은 봐도 된다). 그 밖은 내용을 읽을 수 있다고 본다
const PS_NAMES = new Set(['get-childitem', 'gci', 'ls', 'dir', 'test-path', 'get-item', 'gi', 'resolve-path', 'rvpa', 'split-path', 'start-process', 'start', 'saps',
  'invoke-item', 'ii', 'explorer', 'write-output', 'write-host', 'echo', 'set-location', 'cd', 'sl', 'chdir', 'push-location', 'pushd', 'pop-location', 'popd',
  'get-location', 'pwd', 'gl', 'new-item', 'ni', 'mkdir', 'md', 'select-object', 'select', 'sort-object', 'sort', 'format-table', 'ft', 'format-list', 'fl', 'format-wide',
  'where-object', 'where', '?', 'foreach-object', '%', 'foreach', 'measure-object', 'measure', 'group-object', 'out-host', 'out-string', 'get-date', 'get-process', 'ps',
  'get-service', 'get-command', 'gcm', 'get-help', 'help', 'get-member', 'gm', 'get-psdrive', 'get-itemproperty', 'gp', 'get-variable', 'get-alias', 'clear-host', 'cls',
  'exit', 'return', 'if', 'else', 'elseif', 'for', 'while', 'try', 'catch', 'finally', 'param', 'true', 'false', 'null', 'out-gridview', 'ogv']);
// 사용자 앱으로 여는 것이 아니라 프로그램을 돌리는 Start-Process 대상
const RUNNABLE = /\.(exe|com|bat|cmd|ps1|psm1|vbs|js|py|pyw|msi|lnk)$|^[^.]*$/i;
// 하위 폴더까지 내려가는 것 — 이 명령에 -Recurse·-Depth·/s 가 붙을 때만
const PS_WALKERS = new Set(['get-childitem', 'gci', 'ls', 'dir', 'copy-item', 'cp', 'copy', 'cpi', 'remove-item', 'rm', 'del', 'ri', 'rd', 'rmdir', 'erase', 'compress-archive', 'findstr', 'select-string', 'sls']);
const PS_LISTERS = new Set(['get-childitem', 'gci', 'ls', 'dir']);
// 경로를 글자로 숨길 수 있는 것 — 무엇을 여는지 알 수 없으니 보호 대상이 있을 때는 막는다
const PS_OPAQUE = /(^|[^\w-])(invoke-expression|iex|frombase64string|unescapedatastring|newscriptblock|invokescript)(?![\w-])|\[char\]|\[char\[\]\]|\[regex\]::unescape|\[scriptblock\]::create|getstring\(\s*(\[byte\[\]\]|@\(|\(\s*\[byte|\$\w+\s*\)\s*$)|\[byte\[\]\]\s*\(?\s*@?\(?\s*(0x)?\d|\.invokecommand\b|(powershell|pwsh)(\.exe)?\b[^|;\n]*\s-(e|ec|en|enc|enco|encod|encode|encoded|encodedcommand)\s/i;
/** PowerShell 명령 이름 — 운영체제와 상관없이 대소문자를 가리지 않는다 */
const psn = (w) => bn(w).toLowerCase().replace(/\.exe$/, '');
const stripQ = (x) => x.replace(/^['"]|['"]$/g, '');
const PS_ARG = String.raw`('[^']*'|"[^"]*"|[^\s'"()]+)`;

/** PowerShell 단어 나누기 — 따옴표 안 공백·기호는 끊지 않는다('' 는 '). 기호(; | { } ( ) , = 줄바꿈)는 { op } 로 */
function psWords(s) {
  const out = [];
  let cur = '', has = false, q = false;
  const push = () => { if (has) out.push({ w: cur, q }); cur = ''; has = false; q = false; };
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === "'") { let j = i + 1; for (; j < s.length; j++) { if (s[j] === "'") { if (s[j + 1] === "'") { cur += "'"; j++; continue; } break; } cur += s[j]; } has = true; q = true; i = j; continue; }
    if (c === '"') { let j = i + 1; for (; j < s.length && s[j] !== '"'; j++) cur += s[j]; has = true; q = true; i = j; continue; }
    if (c === '\n' || ';|(){},='.includes(c)) { push(); out.push({ op: c }); continue; }
    if (/\s/.test(c)) { push(); continue; }
    cur += c; has = true;
  }
  push();
  return out;
}

/**
 * PowerShell 글자를 PowerShell 처럼 정리 — 주석(# … 줄 끝, <# … #>)을 빼고, 여러 줄 문자열(@' … '@ · @" … "@)은 한 단어의 따옴표 글자로.
 * 이걸 안 하면 주석 속 it's 의 ' 가 뒤 명령을 문자열로 삼켜 검사를 피한다
 */
function psClean(s) {
  let out = '';
  for (let i = 0; i < s.length;) {
    const c = s[i];
    if (c === '@' && (s[i + 1] === "'" || s[i + 1] === '"') && /^[ \t]*\r?\n/.test(s.slice(i + 2))) {
      const q = s[i + 1];
      const nl = s.indexOf('\n', i + 2);
      const m = s.slice(nl + 1).match(new RegExp(`(^|\\n)[ \\t]*${q}@`));
      const end = m ? nl + 1 + m.index + m[0].length : s.length;
      const body = m ? s.slice(nl + 1, nl + 1 + m.index) : s.slice(nl + 1);
      out += `'${body.replace(/'/g, "''")}'`;
      i = end;
      continue;
    }
    if (c === "'") { let j = i + 1; for (; j < s.length; j++) { if (s[j] === "'") { if (s[j + 1] === "'") { j++; continue; } break; } } out += s.slice(i, j + 1); i = j + 1; continue; }
    if (c === '"') { let j = i + 1; for (; j < s.length && s[j] !== '"'; j++) if (s[j] === '`') j++; out += s.slice(i, j + 1); i = j + 1; continue; }
    if (c === '<' && s[i + 1] === '#') { const e = s.indexOf('#>', i + 2); i = e < 0 ? s.length : e + 2; out += ' '; continue; }
    if (c === '#' && (i === 0 || /[\s;|({]/.test(s[i - 1]))) { const e = s.indexOf('\n', i); i = e < 0 ? s.length : e; continue; }
    out += c; i++;
  }
  return out;
}

function psCheck(cmd0, cwd, where = 'PowerShell 명령', depth = 0) {
  // PowerShell 은 둥근 따옴표(‘ ’ ‚ ‛ · “ ” „)도 따옴표로 읽는다 — 같은 꼴로 맞춰야 띄어쓰기 든 경로가 쪼개지지 않는다
  let s = String(cmd0).normalize('NFC').replace(/[\u2018\u2019\u201A\u201B]/g, "'").replace(/[\u201C\u201D\u201E]/g, '"')
    .replace(/(^|[\s(;|{])[\u2013\u2014\u2015](?=[A-Za-z])/g, '$1-'); // –Recurse · —Path 도 옵션이다
  s = psClean(s);
  if (guarded() && PS_OPAQUE.test(s)) deny(userDirs[0] ?? raws[0], `${where}에 글자를 풀거나 만들어 실행하는 부분(iex·base64·[char]·-EncodedCommand)이 있어 어떤 파일을 여는지 확인할 수 없음. 설치 명령(irm … | iex)이면 사용자가 직접 실행하세요`);
  // 백틱 이스케이프, 문자열 잇기('C:\Users\' + '인사'), 변수($d = '…'), Join-Path·[IO.Path]::Combine 을 풀어서 본다
  s = s.replace(/`(.)/gs, '$1').replace(/(['"])\s*\+\s*(['"])/g, '');
  for (let k = 0; k < 3; k++) {
    const vars = {};
    for (const m of s.matchAll(/\$([A-Za-z_]\w*)\s*=\s*(?:(['"])(.*?)\2|([^\s;|]+))/g)) vars[m[1].toLowerCase()] = m[3] ?? m[4];
    // 혼자 선 변수($f)는 따옴표로 감싸 한 단어로(값에 띄어쓰기가 있어도), 글자 안의 변수("$d\인사")는 그대로 넣는다
    s = s.replace(/\$\{([A-Za-z_]\w*)\}|\$([A-Za-z_]\w*)(?![:\w]|\s*=(?!=))/g, (all, a, b, at, str) => {
      const n = (a ?? b).toLowerCase();
      if (!(n in vars) || n === 'home') return all;
      const alone = /^$|[\s;|(){},=]$/.test(str.slice(Math.max(0, at - 1), at)) && /^($|[\s;|(){},])/.test(str.slice(at + all.length));
      return alone ? `'${vars[n].replace(/'/g, "''")}'` : vars[n];
    });
    s = s.replace(new RegExp(String.raw`join-path\s+(?:-path\s+)?${PS_ARG}\s+(?:-childpath\s+)?${PS_ARG}`, 'gi'), (_, a, b) => `'${stripQ(a)}/${stripQ(b)}'`)
      .replace(/\[(?:system\.)?io\.path\]::combine\(([^()]*)\)/gi, (_, a) => `'${a.split(',').map((x) => stripQ(x.trim())).join('/')}'`);
  }
  const words = psWords(s);
  // 명령 단위(; | { } ( ) 줄바꿈 && ||)로 나눠 머리 명령을 본다 — $x = Get-Item … 은 = 다음, & · . 호출은 그다음
  const segs = [[]];
  for (const t of words) { if (t.op ? t.op !== ',' && t.op !== '=' : (t.w === '&&' || t.w === '||')) segs.push([]); else segs.at(-1).push(t); }
  const heads = [];
  const cmds = segs.filter((g) => g.length).map((g) => {
    const eq = g.map((t) => t.op).lastIndexOf('=');
    let ws = g.slice(eq + 1).filter((t) => !t.op);
    let called = false;
    if (ws[0] && !ws[0].q && /^[&.]$/.test(ws[0].w)) { ws = ws.slice(1); called = true; }
    // Start-Process 프로그램 -ArgumentList … — 프로그램을 돌리면(문서 열기가 아니면) 그 명령으로 본다
    if (/^(start-process|start|saps)$/.test(psn(ws[0]?.w ?? ''))) {
      const val = (re) => { const i = ws.findIndex((t) => !t.q && re.test(t.w)); return i > 0 ? ws[i + 1] : null; };
      const fp = val(/^-filepath$/i) ?? ws.slice(1).find((t, i, a) => (t.q || !t.w.startsWith('-')) && !(i > 0 && !a[i - 1].q && /^-/.test(a[i - 1].w)));
      if (fp && RUNNABLE.test(fp.w)) { const al = val(/^-(argumentlist|args)$/i); ws = [{ w: fp.w, q: false }, ...(al ? psWords(al.w).filter((t) => !t.op) : [])]; called = true; }
    }
    ws.called = called;
    heads.push(ws[0] && { ...ws[0], called });
    return ws;
  });
  // 따옴표 친 머리는 글자(출력)지만 & "C:\…\python.exe" 처럼 부르면 프로그램이다. .Count 같은 속성 보기는 이름 보기. 링크 만들기는 내용에 닿는 것
  const isName = (h) => !h || (h.q && !h.called) || /^-?\d/.test(h.w) || /^\.(count|length|name|fullname|basename|extension|exists|lastwritetime|creationtime|mode|directoryname)$/i.test(h.w) || PS_NAMES.has(psn(h.w));
  const content = !heads.every(isName) || /\$\{[a-z]:/i.test(s) || /-itemtype\s+['"]?(hardlink|symboliclink|junction)/i.test(s);
  const namesOnly = !content;
  const flag = (ws, re) => ws.slice(1).some((t) => !t.q && re.test(t.w));
  const recs = cmds.map((ws) => { const h = psn(ws[0]?.w ?? ''); return (PS_WALKERS.has(h) && flag(ws, /^-(r|re|rec|recu|recur|recurs|recurse|depth)(:.*)?$/i)) || (/^(dir|findstr|xcopy)$/.test(h) && flag(ws, /^\/s$/i)) || /^(robocopy|tree|compress-archive|tar|7z|7za|xcopy)$/.test(h); }); // 압축은 늘 하위 폴더까지 담는다
  // 변수 묶음(@p = @{ Recurse = $true })으로 넘긴 -Recurse 도
  if (/(^|[\s;{])(recurse|depth)\s*=\s*(\$true|\d)/i.test(s)) cmds.forEach((ws, i) => { if (PS_WALKERS.has(psn(ws[0]?.w ?? '')) && ws.some((t) => /^@\w+$/.test(t.w))) recs[i] = true; });
  // 훑는 명령이 하나라도 있으면 명령 안의 모든 경로를 그 기준으로 — 파이프로 넘긴 폴더('…' | gci -Recurse)·변수 묶음의 Path 도
  const rec = recs.some(Boolean);
  textCheck(s, { names: namesOnly, where });
  // 기준 폴더: 작업 폴더 + cd·Set-Location 으로 옮긴 곳
  const bases = [cwd];
  for (const ws of cmds) if (/^(cd|chdir|set-location|sl|push-location|pushd)$/.test(psn(ws[0]?.w ?? ''))) { const a = ws.slice(1).find((t) => t.q || !t.w.startsWith('-')); if (a) bases.push(expand(canonText(a.w), cwd)); }
  codeCheck(s, where, bases);
  const tokOf = (t) => canonText(t.w.replace(/^-[a-z]+:/i, '').replace(/^(microsoft\.powershell\.core\\)?filesystem::/i, ''));
  const pathy = (w) => /^(~|\.{1,2}\/|\/)/.test(w) || w.includes('/') || /[*?[]/.test(w) || bases.some((b) => exists(expand(w, b)));
  let hasPath = false;
  cmds.forEach((ws, ci) => {
    const args = ws.slice(1).filter((t) => t.q || !t.w.startsWith('-') || /^-[a-z]+:./i.test(t.w)).map(tokOf).filter((w) => w && w !== '/' && !w.startsWith('$') && pathy(w));
    const head = ws[0] ? tokOf(ws[0]) : '';
    if (ws[0]?.q && pathy(head)) args.unshift(head); // 'C:\x\a.txt' | Get-Content
    for (const w of args) {
      const wild = /[*?[]/.test(w);
      if (!/^[*?[]/.test(w)) hasPath = true;
      for (const b of bases) {
        if (wild) {
          for (const { t: tg, rel } of globTargets(w, b)) {
            if (tg.internal && rel === 'ancestor') continue;
            if (rel === 'equal' || (rel === 'inside' && tg.dir)) { if (!(namesOnly && (!tg.dir || tg.rawdir))) deny(tg, '와일드카드가 그 안을 가리킴'); }
            else if (rel === 'ancestor' && !tg.internal && rec && (content || (tg.dir && !tg.rawdir))) deny(tg, `와일드카드(${w})로 훑는 범위 아래에 보호 대상이 있음`, { scope: true });
          }
        }
        const clean = w.replace(/[*?[].*$/, '').replace(/\/+$/, '');
        if (!clean) continue;
        const p = key(expand(clean, b));
        const h = hit(p);
        if (h && !(namesOnly && (!h.dir || h.rawdir))) deny(h, '명령이 그 안을 가리킴');
        const a = rec ? (content ? ancestorOf(p) : ancestorDirOf(p)) : null;
        if (a) deny(a, `${tilde(p)} 를 하위 폴더까지 훑는 명령인데 그 아래에 보호 대상이 있음`, { scope: true });
        // 폴더 목록을 읽는 명령으로 넘기면(gci 폴더 | Get-Content) 그 폴더 바로 아래 원문 파일도 읽힌다
        if (content && PS_LISTERS.has(psn(ws[0]?.w ?? ''))) for (const r of raws) if (P.dirname(r.key) === p) deny(r, `${tilde(p)} 의 파일을 목록으로 받아 읽는 명령인데 그 안에 원문 파일이 있음`);
      }
    }
    if (content && PS_LISTERS.has(psn(ws[0]?.w ?? '')) && !args.some((w) => !/^[*?[]/.test(w))) for (const b of bases) for (const r of raws) if (P.dirname(r.key) === key(b)) deny(r, '작업 폴더의 파일을 목록으로 받아 읽는 명령인데 그 안에 원문 파일이 있음');
  });
  if (rec && !hasPath) for (const b of bases) {
    const a = content ? ancestorOf(key(b)) : ancestorDirOf(key(b));
    if (a) deny(a, `작업 폴더(${tilde(b)}) 아래를 하위 폴더까지 훑는 명령인데 그 아래에 보호 대상이 있음`, { scope: true });
  }
  // 안에서 다시 부르는 셸 — powershell -Command "…" · cmd /c "…" 의 글자를 같은 규칙으로
  if (depth < 3) for (const ws of cmds) {
    const h = psn(ws[0]?.w ?? '');
    const rest = ws.slice(1);
    if (/^(powershell|pwsh)$/.test(h)) { const k = rest.findIndex((t) => !t.q && /^[-\/](command|c)$/i.test(t.w)); const body = (k >= 0 ? rest.slice(k + 1) : rest.filter((t) => t.q || !t.w.startsWith('-'))).map((t) => t.w).join(' '); if (body) psCheck(body, cwd, '안에서 부르는 PowerShell 명령', depth + 1); }
    if (h === 'cmd') { const k = rest.findIndex((t) => !t.q && /^\/[ck]$/i.test(t.w)); if (k >= 0) psCheck(rest.slice(k + 1).map((t) => t.w).join(' '), cwd, '안에서 부르는 cmd 명령', depth + 1); }
  }
  // 스크립트 실행(.\a.ps1 · & a.ps1 · python a.py)
  for (const ws of cmds) if (ws.length) {
    const w = ws.map((t) => t.w.replace(/\\/g, '/'));
    scriptCheck(w, bases);
    if (guarded() && runsCode(w)) codeCheck(w.join(' '), '실행하는 코드', bases);
  }
}

let input = '';
process.stdin.on('data', (d) => (input += d)).on('end', () => {
  let ev;
  try { ev = JSON.parse(input); } catch { if (guarded()) deny(userDirs[0] ?? raws[0], '훅 입력을 읽지 못해 안전하게 막음'); process.exit(0); }
  try { check(ev); } catch (err) {
    if (guarded()) deny(userDirs[0] ?? raws[0], err?.tooMany ? '중괄호 펼침이 너무 많아 확인할 수 없음' : '검사 중 오류가 나 안전하게 막음');
  }
  process.exit(0);
});

function check(ev) {
  const t = ev.tool_input ?? {};
  const cwd = toP(ev.cwd || process.cwd());
  const abs = (p) => key(expand(p, cwd));

  switch (ev.tool_name) {
    case 'Read': case 'Edit': case 'MultiEdit': case 'NotebookEdit': case 'Write': {
      const p = t.file_path ?? t.notebook_path;
      if (!p) break;
      const h = hit(abs(p));
      // 원문 파일에 쓰기는 괜찮지만(덮어쓰기) 보호 폴더 안 파일 열기·고치기는 막는다
      if (h && !(ev.tool_name === 'Write' && h.dir)) deny(h, `${ev.tool_name} 차단`);
      break;
    }
    case 'Grep': case 'Glob': {
      const p = abs(t.path ?? cwd);
      const h = hit(p);
      if (h && !(ev.tool_name === 'Glob' && (h.rawdir || !h.dir))) deny(h, `${ev.tool_name} 차단`);
      // 상위 폴더를 훑는 검색 — Grep 은 내용을 읽으니 원문 파일까지, Glob 은 이름만 보니 보호 폴더만(** 이거나 그 이름이 패턴에 있을 때)
      const a = ev.tool_name === 'Grep' ? ancestorOf(p) : ancestorDirOf(p);
      if (a && (ev.tool_name === 'Grep' || /\*\*/.test(t.pattern ?? '') || fold(t.pattern ?? '').includes(bn(a.key)))) {
        deny(a, `${ev.tool_name} 검색 범위(${tilde(P.resolve(expand(t.path ?? cwd, cwd)))})가 그 폴더를 품고 있음`, { scope: true });
      }
      break;
    }
    case 'Bash': {
      const cmd = String(t.command ?? '').normalize('NFC');
      const inCwd = hit(key(cwd));
      if (inCwd && !inCwd.internal) deny(inCwd, '작업 폴더가 그 안');
      const { shell, bodies } = splitHeredocs(cmd);
      // 명령 하나하나(; && || | 줄바꿈, $( ) ` 안도 따로) — 첫 단어로 무엇을 하는지 본다
      const split = (txt) => shellCommands(txt);
      const cmds = split(shell);
      // bash -c '…' · sh -c "…" 안의 명령도 같은 규칙으로(두 겹까지)
      for (let depth = 0, k = 0; depth < 2; depth++) {
        const end = cmds.length;
        for (; k < end; k++) {
          const raw = cmds[k].map(unq);
          const ws = unwrap(cmds[k]).map(unq);
          const head = bn(ws[0] ?? '');
          // 셸 이름이 어디에 있든(brew sh -c "…" · nice -n 5 bash -c "…") 그 뒤 -c 의 글자를 명령으로
          const sh = ws.findIndex((w) => /^((ba|z|da|k|c|tc|fi)?sh|su|script)$/.test(bn(w)));
          const i = sh >= 0 ? ws.indexOf('-c', sh + 1) : -1;
          if (i > 0 && ws[i + 1]) cmds.push(...split(ws[i + 1]));
          const S = raw.findIndex((w) => w === '-S' || w.startsWith('--split-string'));
          if (bn(raw[0] ?? '') === 'env' && S >= 0) cmds.push(...split(raw[S].includes('=') ? raw[S].split('=').slice(1).join('=') : (raw[S + 1] ?? '')));
          if (head === 'watch') cmds.push(...split(ws.slice(1).filter((w) => !w.startsWith('-')).join(' ')));
        }
      }
      const words = shellWords(shell);
      if (guarded()) {
        // 셸 설정 eval(brew shellenv 등) 명령은 빼고 본다
        const safeEval = (c) => { const ws = unwrap(c).map(unq); return bn(ws[0] ?? '') === 'eval' && ws.length === 2 && SAFE_EVAL.test(ws[1]); };
        const bareAll = cmds.filter((c) => !safeEval(c)).flat().map((w) => bn(unq(w)));
        const op = cmds.find(opaque) ?? (bareAll.some((w) => w === 'eval' || w === 'uudecode') || (bareAll.includes('base64') && words.some((w) => /^(-d|-D|--decode)$/.test(w))) || (bareAll.includes('xxd') && words.some((w) => /^-r/.test(w))) ? [bareAll.find((w) => /^(eval|uudecode|base64|xxd)$/.test(w))] : null);
        if (op) deny(userDirs[0] ?? raws[0], `${unq(op[0])} 가 든 명령은 어떤 파일을 여는지 확인할 수 없음`);
        const inner = [...shell.matchAll(/\$\(([^()]*)\)|`([^`]*)`/g)].map((m) => m[1] ?? m[2]);
        if (inner.some((x) => ENCODED.test(x))) deny(userDirs[0] ?? raws[0], '명령 치환 안에서 이스케이프로 글자를 만드는 명령은 어떤 파일을 여는지 확인할 수 없음');
      }
      // 변수: VAR=값, for X in 목록, 환경 변수는 그 값. $(…)·read 로 정한 것만 "모르는 값"(그 폴더의 아무 파일 = *)
      const vars = {}, unknown = new Set();
      words.forEach((w, i) => {
        const m = w.match(/^([A-Za-z_]\w*)=(.*)$/s);
        if (m) { if (m[2] === '') unknown.add(m[1]); else vars[m[1]] = m[2]; } // f=$(…) 는 값이 빈 것으로 읽힌다
        if (w === 'read') for (const x of words.slice(i + 1)) { if (/^[A-Za-z_]\w*$/.test(x)) unknown.add(x); else if (!x.startsWith('-')) break; }
        if (w === 'for' && words[i + 2] === 'in') {
          const items = [];
          for (const x of words.slice(i + 3)) { if (x === 'do') break; items.push(x); }
          if (items.length === 1) vars[words[i + 1]] = items[0]; else unknown.add(words[i + 1]);
        }
      });
      const sub = (w) => w.replace(/\$\{?([A-Za-z_]\w*)\}?/g, (all, n) => {
        if (n === 'HOME') return HOME;
        if (n === 'PWD') return cwd;
        if (vars[n] !== undefined) return vars[n];
        if (unknown.has(n)) return '*';
        return process.env[n] ?? all; // PATH·TMPDIR 등은 실제 값, 모르는 건 글자 그대로(어떤 파일과도 맞지 않음)
      });
      const segsFirst = cmds.map((ws) => unwrap(ws)[0] ?? ws[0]);
      // 명령 치환·프로세스 치환이 있으면 안에서 무엇이든 돌 수 있다 — echo "$(cat 원문)" 은 이름 보기가 아니다
      const namesOnly = !/\$\(|`|[<>]\(/.test(shell) && segsFirst.length > 0 && segsFirst.every((c) => NAMES_ONLY.has(bn(unq(c))));
      const recs = cmds.map(recursionOf);
      // 위치와 상관없이 — 감싸는 말을 다 알 수는 없으니 따옴표 밖 단어 어디에든 훑는 명령 이름이 있으면 그 명령으로 본다.
      // 이름을 설명·찾기·설치하는 명령의 인자(echo tar 사용법 · which rg · man tar · brew install rg)는 빼고
      // 다른 프로그램을 실행할 수 없는 것만(npm exec · git -c · yarn dlx 처럼 실행할 수 있는 건 넣지 않는다)
      const TALK = new Set(['echo', 'printf', 'which', 'whereis', 'type', 'whatis', 'apropos']); // brew sh·pip install 은 실행할 수 있어 넣지 않는다
      // man 은 옵션이 없을 때만(-P·--pager·-H 로 다른 프로그램을 실행할 수 있다)
      const talkOnly = (c) => { const ws = unwrap(c).map(unq); const h = bn(ws[0] ?? ''); return TALK.has(h) || (h === 'man' && ws.slice(1).every((w) => !w.startsWith('-')))
        || (h === 'brew' && /^(install|uninstall|reinstall|upgrade|info|search|list|update|outdated|doctor|desc|home)$/.test(ws[1] ?? '')); }; // brew sh·brew ruby 는 아니다
      // 이름을 말하기만 하는 명령(첫 단어가 TALK)의 단어는 통째로 뺀다
      const bare = cmds.filter((c) => !talkOnly(c)).flat().map((w) => bn(unq(w)));
      const named = (re) => bare.some((w) => re.test(w));
      const anyR = bare.some((w) => /^(-[a-zA-Z]*[rR][a-zA-Z]*|--recursive)$/.test(w));
      const fallback = !recs.includes('content') && (named(/^(rg|ag|ack|tar|7z|ditto)$/) || (named(/^(grep|egrep|fgrep|zgrep|cp|scp|rsync|zip)$/) && anyR)
        || (named(/^find$/) && bare.some((w) => /^(-exec|-execdir|-ok|-okdir|-delete)$/.test(w))));
      if (fallback) recs.push('content');
      let recContent = recs.includes('content');
      let recNames = !recContent && recs.includes('names');
      // 따옴표 밖 와일드카드로 하위 폴더까지 내려가면(*/x · **/x) — 이름만 보는 명령(ls -d */)이 아니면 내용을 읽는 재귀
      const unquotedGlobs = words.map(sub).filter((w) => /[*?[{]/.test(w));
      if (!namesOnly && unquotedGlobs.some((w) => /\*\*|\*\//.test(w))) recContent = true;
      // 재귀로 훑는 명령의 기준 폴더 아래에 보호 대상이 있나 — 내용을 읽으면 원문 파일까지, 이름만 보면 보호 폴더만
      const under = (p) => (recContent ? ancestorOf(p) : recNames ? ancestorDirOf(p) : null);

      // 조각: 셸 단어(+ 그 안의 python -c "open('…')" 같은 조각) + heredoc 본문의 조각(글자 그대로). 옵션(-x)은 뺀다.
      // 따옴표·heredoc 안의 * ? [ { 는 글자지만, 실제 폴더로 시작하는 경로 모양 조각(glob.glob('~/x/*'))은 와일드카드로 본다
      const quotedPath = (x) => (/^(~|\.{1,2}[/\\]|[A-Za-z]:[/\\]|\/[^/*?[{-])/.test(unq(x)) ? unq(x) : x);
      const pieces = [...new Set([
        ...words.map(sub).flatMap((w) => [w, ...w.split(/[=<>|;&()`'",\s]/).map(quotedPath)]),
        ...bodies.flatMap((b) => lit(b).split(/[=<>|;&()`'",\s]/).map(quotedPath)),
      ].map((x) => x.replace(/^[A-Za-z_]\w*=/, '').trim()).filter((x) => x && !x.startsWith('-') && x !== '/'))];

      // 1) 글자 검사 — 원래 명령과 셸이 풀어 쓴 조각 어디에든 원문 파일 이름·보호 폴더 경로가 보이면(따옴표·heredoc·python 안이라도)
      const texts = [fold(cmd.replace(/\\(.)/g, '$1')), fold(unq(pieces.join('\n'))), ...(WIN ? [canonText(cmd), canonText(unq(pieces.join('\n')))] : [])];
      if (!namesOnly) for (const r of raws) if (r.base.length >= 4 && texts.some((x) => x.includes(r.base))) deny(r, '명령에 그 파일 이름이 들어 있음');
      for (const d of userDirs) if (!(namesOnly && d.rawdir)) for (const f of d.forms) for (const x of texts) {
        const i = x.indexOf(f);
        if (i >= 0 && /^($|[/\s"'`)\]}])/.test(x.slice(i + f.length))) deny(d, '명령에 그 폴더 경로가 들어 있음');
      }

      // 2) 경로 검사 — cd 로 옮겨 간 폴더도 상대 경로의 기준으로 (cd ~/Documents && cat 인사/a.txt)
      const bases = [cwd];
      words.forEach((w, i) => { if ((w === 'cd' || w === 'pushd') && words[i + 1]) bases.push(expand(sub(words[i + 1]), cwd)); });
      // 코드를 돌리는 명령 — 스크립트 파일 내용, 인라인 코드 속 '인사' 같은 경로 조각, 안에서 부르는 PowerShell 까지
      for (const c of cmds) {
        const ws = unwrap(c).map((w) => sub(unq(w)));
        scriptCheck(ws, bases);
        if (guarded() && runsCode(ws)) codeCheck(c.map(unq).join(' '), '실행하는 코드', bases);
        const ps = ws.findIndex((w) => /^(powershell|pwsh)$/.test(bn(w)));
        const cm = ws.findIndex((w) => bn(w) === 'cmd');
        if (cm >= 0) { const k = ws.findIndex((w, i) => i > cm && /^\/{1,2}[ck]$/i.test(w)); if (k > 0) psCheck(ws.slice(k + 1).join(' '), cwd, '안에서 부르는 cmd 명령'); }
        if (ps >= 0) psCheck(ws.slice(ps + 1).filter((w) => !/^-(command|c|noprofile|nop|noninteractive|noni|executionpolicy|ep|bypass|nologo)$/i.test(w)).join(' '), cwd, '안에서 부르는 PowerShell 명령');
      }
      for (const w of pieces) {
        for (const b of bases) {
          // 와일드카드·중괄호는 보호 대상과 직접 맞춰 본다 (인?/a.txt · 인[사] · {인사,x} · *쓰기.txt · $(ls -d 인*))
          if (/[*?[{]/.test(w)) {
            for (const { t: tg, rel } of globTargets(w, b)) {
              if (tg.internal && rel === 'ancestor') continue;
              if (rel === 'equal' || (rel === 'inside' && tg.dir)) { if (!(namesOnly && (!tg.dir || tg.rawdir))) deny(tg, '와일드카드가 그 안을 가리킴'); }
              else if (rel === 'ancestor' && !tg.internal && (recContent || (recNames && tg.dir && !tg.rawdir))) deny(tg, `와일드카드(${unq(w)})로 훑는 범위 아래에 보호 대상이 있음`, { scope: true });
            }
          }
          const clean = unq(w.replace(/[*?[{].*$/, '')).replace(/\/+$/, '');
          if (!clean) continue; // "*.pdf" 같은 이름 패턴(find -name 값 등) — 경로 없는 재귀는 아래 작업 폴더 검사가 맡는다
          const p = key(expand(clean, b));
          const h = hit(p);
          if (h && !(namesOnly && (!h.dir || h.rawdir))) deny(h, '명령이 그 안을 가리킴'); // 원문 파일·원문 결과 폴더에 ls -l·open 은 괜찮다
          const a = fallback && under(p);
          if (a) deny(a, `${tilde(p)} 를 재귀로 훑는 명령인데 그 아래에 보호 대상이 있음`, { scope: true });
        }
        // 기준 폴더를 모르는 상대 경로라도 경로 조각에 보호 폴더 이름이 그대로 있으면(…/인사/…) — 사용자 보호 폴더만
        if (WIN ? /[/\\]/.test(w) : w.includes('/')) {
          const parts = fold(unq(w)).split(WIN ? /[/\\]/ : '/');
          const tg = userDirs.find((d) => !(namesOnly && d.rawdir) && bn(d.key).length >= 2 && parts.includes(bn(d.key)));
          if (tg) deny(tg, '명령에 그 폴더 이름이 경로로 들어 있음');
        }
      }
      // 경로 없이 재귀로 훑는 명령(grep -r 홍길동 / rg 홍길동 / find -name …)은 기준 폴더 아래 전체를 본다.
      // 경로를 준 명령은 위에서 그 경로로 판단했다 — 실제로 있는 폴더 이름(Desktop)도 경로로 친다. 와일드카드로 시작하는 단어(*/*.txt)는 아니다
      const hasPathArg = pieces.some((w) => {
        const c = unq(w.replace(/[*?[{].*$/, ''));
        return /[/~]/.test(c) || c === '.' || c === '..' || (c && bases.some((b) => exists(expand(c, b))));
      });
      const isPathArg = (w, bs = bases) => {
        const c = unq(sub(w).replace(/[*?[{].*$/, ''));
        return /[/~]/.test(c) || c === '.' || c === '..' || (c && bs.some((b) => exists(expand(c, b))));
      };
      const cwdScan = (kind) => { for (const b of bases) { const a = kind === 'content' ? ancestorOf(key(b)) : ancestorDirOf(key(b)); if (a) deny(a, `작업 폴더(${tilde(b)}) 아래를 재귀로 훑는 명령인데 그 아래에 보호 대상이 있음`, { scope: true }); } };
      // 재귀 명령마다 — 제 인자에 경로가 없으면 작업 폴더를 훑는다(script -c 'rg 홍' /dev/null 의 /dev/null 은 rg 의 경로가 아니다)
      const LOOSE = /^(rg|ag|ack|tar|7z|ditto)$/;
      const looseKind = (c) => {
        if (talkOnly(c)) return null;
        const ws = c.map((w) => bn(unq(w)));
        const r = ws.some((w) => /^(-[a-zA-Z]*[rR][a-zA-Z]*|--recursive)$/.test(w));
        if (ws.slice(1).some((w) => LOOSE.test(w)) || (ws.slice(1).some((w) => /^(grep|egrep|fgrep|zgrep|cp|scp|rsync|zip)$/.test(w)) && r)
          || (ws.slice(1).includes('find') && ws.some((w) => /^(-exec|-execdir|-ok|-okdir|-delete)$/.test(w)))) return 'content';
        return null;
      };
      for (const c of cmds) {
        let kind = recursionOf(c);
        if (!kind && looseKind(c)) { // 모르는 감싸는 말 + rg … — 받는 곳 빼기 없이 모든 인자, 경로가 없으면 작업 폴더
          for (const w of c.slice(1).map((x) => sub(unq(x))).filter((x) => !x.startsWith('-'))) for (const b of bases) {
            const pp = key(expand(w.replace(/[*?[{].*$/, '').replace(/\/+$/, '') || '.', b));
            const a = ancestorOf(pp);
            if (a) deny(a, `${tilde(pp)} 를 재귀로 훑는 명령인데 그 아래에 보호 대상이 있음`, { scope: true });
          }
          if (!c.slice(1).some((w) => !unq(w).startsWith('-') && isPathArg(w))) cwdScan('content');
          continue;
        }
        if (!kind) continue;
        const ws = unwrap(c).map((w) => sub(unq(w)));
        const name = bn(ws[0] ?? '');
        const rest = ws.slice(1);
        // 이 명령 안에서만 받는 곳(쓰는 곳) 자리를 뺀다 — 같은 글자가 다른 명령에 나와도 그쪽은 그대로 검사
        const skip = new Set();
        // cp·mv 의 -t(받는 곳 지정) — 묶음 옵션(-rt · -tr) 어디에 있든. -t 뒤에 글자가 붙으면 그게 값(다음 단어가 아니다)
        let targetGiven = false;
        if (/^(cp|mv)$/.test(name)) rest.forEach((w, i) => {
          if (w === '--target-directory' || /^-[a-zA-Z]*t$/.test(w)) { skip.add(i + 1); targetGiven = true; }
          else if (/^-[a-zA-Z]*t./.test(w) || w.startsWith('--target-directory=')) targetGiven = true;
        });
        const positional = rest.map((w, i) => [w, i]).filter(([w, i]) => !w.startsWith('-') && !skip.has(i));
        if (/^(cp|scp|rsync|ditto|mv)$/.test(name) && !targetGiven && positional.length >= 2) skip.add(positional.at(-1)[1]);
        if (name === 'zip' && positional.length >= 2 && /\.zip$/i.test(positional[0][0])) skip.add(positional[0][1]);
        // tar: 첫 인자가 - 없는 키(czf)이거나 - 옵션 묶음에 f 가 있으면 그다음이 압축 파일 — 아무 낱말(foo)의 f 는 아니다
        if (name === 'tar') rest.forEach((w, i) => { if ((i === 0 && /^[a-zA-Z]*f[a-zA-Z]*$/.test(w) && /^[AcdrtuxzjJvpfOSkmhWlLbBCgGMNVZ]+$/.test(w)) || /^-[a-zA-Z]*f$/.test(w)) skip.add(i + 1); });
        let cmdBases = bases;
        if (name === 'tar') rest.forEach((w, i) => { if ((w === '-C' || w === '--directory') && rest[i + 1]) { skip.add(i + 1); cmdBases = [expand(rest[i + 1], cwd)]; } });
        let args = rest.map((w, i) => [w, i]).filter(([w, i]) => !w.startsWith('-') && !skip.has(i)).map(([w]) => w);
        if (/^(grep|egrep|fgrep|zgrep|rg|ag|ack)$/.test(name) && !rest.some((w) => /^(-e|-f|--regexp|--file)/.test(w))) args = args.slice(1); // 첫 인자는 찾을 말
        for (const w of args) for (const b of cmdBases) {
          const g = /[*?[{]/.test(w) ? globTargets(w, b) : [];
          for (const { t: tg, rel } of g) if (rel === 'ancestor' && !tg.internal && (kind === 'content' || (tg.dir && !tg.rawdir))) deny(tg, `${w} 를 재귀로 훑는 명령인데 그 아래에 보호 대상이 있음`, { scope: true });
          const clean = w.replace(/[*?[{].*$/, '').replace(/\/+$/, '');
          if (!clean) continue;
          const pp = key(expand(clean, b));
          const a = kind === 'content' ? ancestorOf(pp) : ancestorDirOf(pp);
          if (a) deny(a, `${tilde(pp)} 를 재귀로 훑는 명령인데 그 아래에 보호 대상이 있음`, { scope: true });
        }
        if (!args.some((w) => isPathArg(w, cmdBases))) cwdScan(kind);
      }
      // 위치로 찾은 재귀(감싸는 말을 모름)는 명령 전체에 경로가 없을 때
      if ((recContent || recNames) && !hasPathArg) cwdScan(recContent ? 'content' : 'names');
      break;
    }
    case 'PowerShell': {
      const inCwd = hit(key(cwd));
      if (inCwd && !inCwd.internal) deny(inCwd, '작업 폴더가 그 안');
      psCheck(t.command ?? '', cwd);
      break;
    }
  }
}
