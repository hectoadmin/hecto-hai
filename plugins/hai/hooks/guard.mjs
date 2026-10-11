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

const HOME = os.homedir();
const DATA = process.env.HAI_DATA_DIR || path.join(HOME, '.hai-mcp');
const FOLD = os.platform() === 'darwin' || os.platform() === 'win32';
const fold = (s) => { const n = String(s).normalize('NFC'); return FOLD ? n.toLowerCase() : n; };
const norm = (p) => fold(path.resolve(p));
const expand = (p, cwd = process.cwd()) => {
  const s = String(p).replace(/^\$HOME(?=\/|$)/, HOME).replace(/^\$\{HOME\}(?=\/|$)/, HOME);
  return path.resolve(cwd, s.startsWith('~') ? path.join(HOME, s.slice(1)) : s);
};
const real = (p) => { try { return fs.realpathSync(p); } catch { return p; } };
const key = (p) => norm(real(p));
const tilde = (p) => (p.startsWith(HOME) ? `~${p.slice(HOME.length)}` : p);

const opt = process.env.CLAUDE_PLUGIN_OPTION_PROTECTED_DIRS ?? '';
// 원문 결과 폴더(받아쓰기·OCR 기본 저장 곳)도 보호 폴더처럼 — 설정이 없으면 기본값. HAI_RAW_DIR 은 시험용
const rawOpt = process.env.HAI_RAW_DIR ?? process.env.CLAUDE_PLUGIN_OPTION_RAW_DIR ?? '';
const rawDir = rawOpt && !rawOpt.includes('${') ? rawOpt : path.join(HOME, 'Documents', 'HAI 원문');
const userDirs = [...(opt.includes('${') ? [] : opt.split(',').map((s) => s.trim()).filter(Boolean)), ...(fs.existsSync(expand(rawDir)) ? [rawDir] : [])]
  .map((d) => { const p = real(expand(d)); return { shown: tilde(p), key: norm(p), dir: true, forms: [fold(p), fold(tilde(p))] }; });
const internal = { shown: '~/.hai-mcp/tmp', key: key(path.join(DATA, 'tmp')), dir: true, internal: true };
let raws = [];
try {
  raws = [...new Set(fs.readFileSync(path.join(DATA, 'raw-files.log'), 'utf8').split('\n').filter(Boolean))]
    .filter((f) => fs.existsSync(f)) // 지운 파일 때문에 그 폴더 검색이 계속 막히지 않게
    .map((f) => ({ shown: tilde(f), key: norm(f), dir: false, base: fold(path.basename(f)) }));
} catch { /* 없음 */ }
const targets = [...userDirs, internal, ...raws];
const watched = [...userDirs, ...raws]; // 상위 폴더 검사 대상(내부 tmp 제외)
const guarded = () => userDirs.length > 0 || raws.length > 0;

const inside = (p, dir) => { const rel = path.relative(dir, p); return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel)); };
/** p(정규화)가 보호 대상 안이면 그 대상 */
const hit = (p) => targets.find((t) => (t.dir ? inside(p, t.key) : p === t.key));
/** p 가 보호 대상을 품은 상위 폴더면 그 대상 */
const ancestorOf = (p) => watched.find((t) => t.key !== p && inside(t.key, p));
/** 이름만 보는 검색용 — 원문 파일은 이름을 Claude 가 이미 알고(자기가 만들었다) 내용이 나가지 않으니 보호 폴더만 */
const ancestorDirOf = (p) => userDirs.find((t) => t.key !== p && inside(t.key, p));

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
    const c = path.basename(w);
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
  const c = path.basename(unq(ws[0] ?? ''));
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
  if (/^(tree|du)$/.test(c)) return 'names';
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
function opaque(raw) {
  const ws = unwrap(raw);
  const c = path.basename(unq(ws[0] ?? ''));
  const has = (re) => ws.slice(1).some((w) => re.test(w));
  return c === 'eval' || c === 'uudecode' || (c === 'base64' && has(/^(-d|-D|--decode)$/)) || (c === 'xxd' && has(/^-r/)) || (c === 'openssl' && has(/^(enc|base64)$/));
}
// 명령 치환 안에서 만든 글자(\x·\u·8진 이스케이프) — printf '\xec…' 로 경로를 만들 수 있다
const ENCODED = /\\x[0-9a-fA-F]{1,2}|\\u[0-9a-fA-F]{2,4}|\\U[0-9a-fA-F]{4,8}|\\[0-3][0-7]{2}/;
// 내용을 읽지 않고 이름·속성만 보거나 사용자에게 여는 명령
const NAMES_ONLY = new Set(['ls', 'stat', 'du', 'file', 'echo', 'pwd', 'mkdir', 'touch', 'open', 'which', 'cd', 'xattr', 'mdls']);


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
    let segs = fold(expand(w, base)).split(path.sep).filter(Boolean);
    // 와일드카드 앞의 고정된 부분은 실제 경로(심볼릭 링크 풀기)로 — 대상 키가 realpath 다
    const k = segs.findIndex((x) => /[*?[]/.test(x));
    if (k > 0) {
      const head = fold(real(path.sep + segs.slice(0, k).join(path.sep))).split(path.sep).filter(Boolean);
      segs = [...head, ...segs.slice(k)];
    }
    const res = segs.map((x) => (x === '**' ? '**' : /[*?[]/.test(x) ? globRe(x) : x));
    for (const t of targets) {
      const ts = t.key.split(path.sep).filter(Boolean);
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
  const cwd = ev.cwd || process.cwd();
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
      if (h) deny(h, `${ev.tool_name} 차단`);
      // 상위 폴더를 훑는 검색 — Grep 은 내용을 읽으니 원문 파일까지, Glob 은 이름만 보니 보호 폴더만(** 이거나 그 이름이 패턴에 있을 때)
      const a = ev.tool_name === 'Grep' ? ancestorOf(p) : ancestorDirOf(p);
      if (a && (ev.tool_name === 'Grep' || /\*\*/.test(t.pattern ?? '') || fold(t.pattern ?? '').includes(path.basename(a.key)))) {
        deny(a, `${ev.tool_name} 검색 범위(${tilde(path.resolve(expand(t.path ?? cwd, cwd)))})가 그 폴더를 품고 있음`, { scope: true });
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
          const head = path.basename(ws[0] ?? '');
          // 셸 이름이 어디에 있든(brew sh -c "…" · nice -n 5 bash -c "…") 그 뒤 -c 의 글자를 명령으로
          const sh = ws.findIndex((w) => /^((ba|z|da|k|c|tc|fi)?sh|su|script)$/.test(path.basename(w)));
          const i = sh >= 0 ? ws.indexOf('-c', sh + 1) : -1;
          if (i > 0 && ws[i + 1]) cmds.push(...split(ws[i + 1]));
          const S = raw.findIndex((w) => w === '-S' || w.startsWith('--split-string'));
          if (path.basename(raw[0] ?? '') === 'env' && S >= 0) cmds.push(...split(raw[S].includes('=') ? raw[S].split('=').slice(1).join('=') : (raw[S + 1] ?? '')));
          if (head === 'watch') cmds.push(...split(ws.slice(1).filter((w) => !w.startsWith('-')).join(' ')));
        }
      }
      const words = shellWords(shell);
      if (guarded()) {
        const bareAll = words.map((w) => path.basename(w));
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
      const namesOnly = !/\$\(|`|[<>]\(/.test(shell) && segsFirst.length > 0 && segsFirst.every((c) => NAMES_ONLY.has(path.basename(unq(c))));
      const recs = cmds.map(recursionOf);
      // 위치와 상관없이 — 감싸는 말을 다 알 수는 없으니 따옴표 밖 단어 어디에든 훑는 명령 이름이 있으면 그 명령으로 본다.
      // 이름을 설명·찾기·설치하는 명령의 인자(echo tar 사용법 · which rg · man tar · brew install rg)는 빼고
      // 다른 프로그램을 실행할 수 없는 것만(npm exec · git -c · yarn dlx 처럼 실행할 수 있는 건 넣지 않는다)
      const TALK = new Set(['echo', 'printf', 'which', 'whereis', 'type', 'whatis', 'apropos']); // brew sh·pip install 은 실행할 수 있어 넣지 않는다
      // man 은 옵션이 없을 때만(-P·--pager·-H 로 다른 프로그램을 실행할 수 있다)
      const talkOnly = (c) => { const ws = unwrap(c).map(unq); const h = path.basename(ws[0] ?? ''); return TALK.has(h) || (h === 'man' && ws.slice(1).every((w) => !w.startsWith('-')))
        || (h === 'brew' && /^(install|uninstall|reinstall|upgrade|info|search|list|update|outdated|doctor|desc|home)$/.test(ws[1] ?? '')); }; // brew sh·brew ruby 는 아니다
      // 이름을 말하기만 하는 명령(첫 단어가 TALK)의 단어는 통째로 뺀다
      const bare = cmds.filter((c) => !talkOnly(c)).flat().map((w) => path.basename(unq(w)));
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
      const quotedPath = (x) => (/^(~|\.{1,2}\/|\/[^/*?[{-])/.test(unq(x)) ? unq(x) : x);
      const pieces = [...new Set([
        ...words.map(sub).flatMap((w) => [w, ...w.split(/[=<>|;&()`'",\s]/).map(quotedPath)]),
        ...bodies.flatMap((b) => lit(b).split(/[=<>|;&()`'",\s]/).map(quotedPath)),
      ].map((x) => x.replace(/^[A-Za-z_]\w*=/, '').trim()).filter((x) => x && !x.startsWith('-') && x !== '/'))];

      // 1) 글자 검사 — 원래 명령과 셸이 풀어 쓴 조각 어디에든 원문 파일 이름·보호 폴더 경로가 보이면(따옴표·heredoc·python 안이라도)
      const texts = [fold(cmd.replace(/\\(.)/g, '$1')), fold(unq(pieces.join('\n')))];
      if (!namesOnly) for (const r of raws) if (r.base.length >= 4 && texts.some((x) => x.includes(r.base))) deny(r, '명령에 그 파일 이름이 들어 있음');
      for (const d of userDirs) for (const f of d.forms) for (const x of texts) {
        const i = x.indexOf(f);
        if (i >= 0 && /^($|[/\s"'`)\]}])/.test(x.slice(i + f.length))) deny(d, '명령에 그 폴더 경로가 들어 있음');
      }

      // 2) 경로 검사 — cd 로 옮겨 간 폴더도 상대 경로의 기준으로 (cd ~/Documents && cat 인사/a.txt)
      const bases = [cwd];
      words.forEach((w, i) => { if ((w === 'cd' || w === 'pushd') && words[i + 1]) bases.push(expand(sub(words[i + 1]), cwd)); });
      for (const w of pieces) {
        for (const b of bases) {
          // 와일드카드·중괄호는 보호 대상과 직접 맞춰 본다 (인?/a.txt · 인[사] · {인사,x} · *쓰기.txt · $(ls -d 인*))
          if (/[*?[{]/.test(w)) {
            for (const { t: tg, rel } of globTargets(w, b)) {
              if (tg.internal && rel === 'ancestor') continue;
              if (rel === 'equal' || (rel === 'inside' && tg.dir)) { if (!(namesOnly && !tg.dir)) deny(tg, '와일드카드가 그 안을 가리킴'); }
              else if (rel === 'ancestor' && !tg.internal && (recContent || (recNames && tg.dir))) deny(tg, `와일드카드(${unq(w)})로 훑는 범위 아래에 보호 대상이 있음`, { scope: true });
            }
          }
          const clean = unq(w.replace(/[*?[{].*$/, '')).replace(/\/+$/, '');
          if (!clean) continue; // "*.pdf" 같은 이름 패턴(find -name 값 등) — 경로 없는 재귀는 아래 작업 폴더 검사가 맡는다
          const p = key(expand(clean, b));
          const h = hit(p);
          if (h && !(namesOnly && !h.dir)) deny(h, '명령이 그 안을 가리킴'); // 원문 파일에 ls -l·open 은 괜찮다
          const a = fallback && under(p);
          if (a) deny(a, `${tilde(p)} 를 재귀로 훑는 명령인데 그 아래에 보호 대상이 있음`, { scope: true });
        }
        // 기준 폴더를 모르는 상대 경로라도 경로 조각에 보호 폴더 이름이 그대로 있으면(…/인사/…) — 사용자 보호 폴더만
        if (w.includes('/')) {
          const parts = fold(unq(w)).split('/');
          const tg = userDirs.find((d) => path.basename(d.key).length >= 2 && parts.includes(path.basename(d.key)));
          if (tg) deny(tg, '명령에 그 폴더 이름이 경로로 들어 있음');
        }
      }
      // 경로 없이 재귀로 훑는 명령(grep -r 홍길동 / rg 홍길동 / find -name …)은 기준 폴더 아래 전체를 본다.
      // 경로를 준 명령은 위에서 그 경로로 판단했다 — 실제로 있는 폴더 이름(Desktop)도 경로로 친다. 와일드카드로 시작하는 단어(*/*.txt)는 아니다
      const hasPathArg = pieces.some((w) => {
        const c = unq(w.replace(/[*?[{].*$/, ''));
        return /[/~]/.test(c) || c === '.' || c === '..' || (c && bases.some((b) => fs.existsSync(expand(c, b))));
      });
      const isPathArg = (w, bs = bases) => {
        const c = unq(sub(w).replace(/[*?[{].*$/, ''));
        return /[/~]/.test(c) || c === '.' || c === '..' || (c && bs.some((b) => fs.existsSync(expand(c, b))));
      };
      const cwdScan = (kind) => { for (const b of bases) { const a = kind === 'content' ? ancestorOf(key(b)) : ancestorDirOf(key(b)); if (a) deny(a, `작업 폴더(${tilde(b)}) 아래를 재귀로 훑는 명령인데 그 아래에 보호 대상이 있음`, { scope: true }); } };
      // 재귀 명령마다 — 제 인자에 경로가 없으면 작업 폴더를 훑는다(script -c 'rg 홍' /dev/null 의 /dev/null 은 rg 의 경로가 아니다)
      const LOOSE = /^(rg|ag|ack|tar|7z|ditto)$/;
      const looseKind = (c) => {
        if (talkOnly(c)) return null;
        const ws = c.map((w) => path.basename(unq(w)));
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
        const name = path.basename(ws[0] ?? '');
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
          for (const { t: tg, rel } of g) if (rel === 'ancestor' && !tg.internal && (kind === 'content' || tg.dir)) deny(tg, `${w} 를 재귀로 훑는 명령인데 그 아래에 보호 대상이 있음`, { scope: true });
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
  }
}
