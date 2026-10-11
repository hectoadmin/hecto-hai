#!/usr/bin/env node
/**
 * 원문 가드 (PreToolUse). Claude 가 Read·Grep·Glob·Bash 등으로 다음을 직접 열지 못하게 막고 HAI 도구를 쓰라고 돌려보낸다.
 *   1) 보호 폴더 — 플러그인 설정 protected_dirs
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
const userDirs = (opt.includes('${') ? [] : opt.split(',').map((s) => s.trim()).filter(Boolean))
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
const CONTENT_REC = new RegExp([ // 하위 폴더의 내용까지 읽는 명령
  String.raw`(^|[\s;&|(])(grep|egrep|fgrep|zgrep|cp|scp|rsync)\b[^;&|\n]*\s(-[a-zA-Z]*[rR][a-zA-Z]*|--recursive)(?=\s|$)`,
  String.raw`(^|[\s;&|(])(rg|ag|ack|tar|zip|7z)(?=\s|$)`,
  String.raw`(^|[\s;&|(])find\b[^;&\n]*(-exec|-execdir|-ok|-delete|\|\s*xargs)`,
  String.raw`\*\*\/|\/\*\*|(^|\s)\*\*(\s|$)|(^|[\s/])\*\/`,
].join('|'));
const NAME_REC = /(^|[\s;&|(])(find|tree|du)(?=\s|$)|(^|[\s;&|(])ls\b[^;&|\n]*\s-[a-zA-Z]*R/; // 하위 폴더의 이름만 보는 명령
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
const OPAQUE = /\\x[0-9a-fA-F]{1,2}|\\u[0-9a-fA-F]{2,4}|\\U[0-9a-fA-F]{4,8}|\\[0-3][0-7]{2}|(^|[\s;&|(`])(eval|source|uudecode)\b|\bbase64\s+(-d|-D|--decode)\b|\bxxd\s+-r\b|\bopenssl\s+(enc|base64)\b/;
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

function shellWords(cmd) {
  const out = [];
  let cur = '', has = false;
  const push = () => { if (has) out.push(cur); cur = ''; has = false; };
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
      while (j < cmd.length && cmd[j] !== '"') { if (cmd[j] === '\\' && /["\\$`]/.test(cmd[j + 1] ?? '')) { cur += cmd[j + 1]; j += 2; } else { cur += lit(cmd[j]); j++; } }
      has = true; i = j + 1; continue;
    }
    if (/\s/.test(c) || ';&|<>()`'.includes(c)) { push(); i++; continue; }
    if (c === '$' && cmd[i + 1] === '(') { push(); i += 2; continue; }
    cur += c; has = true; i++;
  }
  push();
  return out;
}

/** {a,b} 펼치기(겹치지 않은 것, 최대 64개) */
function braces(w) {
  const m = w.match(/^(.*?)\{([^{}]*,[^{}]*)\}(.*)$/s);
  if (!m) return [w];
  return m[2].split(',').flatMap((x) => braces(m[1] + x + m[3])).slice(0, 64);
}

/**
 * 와일드카드(* ? [..] **)·중괄호가 든 경로를 보호 대상과 직접 맞춰 본다 — 폴더를 훑지 않으니 아무리 넓은 패턴도 빠르고(시간 초과로 통과되지 않음),
 * 개수 상한에 잘려 놓치는 일도 없다. → [{ t: 대상, rel: 'equal'(대상 자체) | 'inside'(보호 폴더 안) | 'ancestor'(대상을 품은 상위) }]
 */
function globTargets(word, base) {
  const out = [];
  for (const w of braces(word)) {
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
/** 패턴 조각들과 대상 경로 조각들의 관계. ** 는 0개 이상의 아무 조각 */
function relate(ps, ts, i = 0, j = 0) {
  if (i === ps.length) return j === ts.length ? 'equal' : 'ancestor';
  if (ps[i] === '**') return relate(ps, ts, i + 1, j) || (j < ts.length ? relate(ps, ts, i, j + 1) : null) || 'ancestor';
  if (j === ts.length) return 'inside';
  const ok = typeof ps[i] === 'string' ? ps[i] === ts[j] : ps[i].test(ts[j]);
  return ok ? relate(ps, ts, i + 1, j + 1) : null;
}

let input = '';
process.stdin.on('data', (d) => (input += d)).on('end', () => {
  const guarded = userDirs.length || raws.length;
  let ev;
  try { ev = JSON.parse(input); } catch { if (guarded) deny(userDirs[0] ?? raws[0], '훅 입력을 읽지 못해 안전하게 막음'); process.exit(0); }
  try { check(ev); } catch { if (guarded) deny(userDirs[0] ?? raws[0], '검사 중 오류가 나 안전하게 막음'); }
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
      // 글자로 확인할 수 없는 형태(인코딩한 바이트·eval·base64 풀기) — 보호 대상이 있는 동안은 막는다
      if ((userDirs.length || raws.length) && OPAQUE.test(cmd)) deny(userDirs[0] ?? raws[0], '인코딩된 글자·eval·base64 풀기가 든 명령은 어떤 파일을 여는지 확인할 수 없음');
      const inCwd = hit(key(cwd));
      if (inCwd && !inCwd.internal) deny(inCwd, '작업 폴더가 그 안');
      const words = shellWords(cmd);
      // VAR=값 은 뒤 단어의 $VAR·${VAR} 에 넣는다 (D=~/Documents; cat $D/인사/a.txt)
      const vars = {};
      for (const w of words) { const m = w.match(/^([A-Za-z_]\w*)=(.*)$/s); if (m) vars[m[1]] = m[2]; }
      // 값을 모르는 변수($f — 명령 치환으로 정한 것 등)는 * 로 — "그 폴더의 어떤 파일이든" 으로 본다
      const sub = (w) => w.replace(/\$\{?([A-Za-z_]\w*)\}?/g, (all, n) => (n === 'HOME' ? HOME : vars[n] || '*')); // f=$(…) 는 값이 빈 것으로 읽힌다 — 모르는 값
      // 셸 단어 + 그 안의 조각(python -c "open('…')" 의 경로처럼 따옴표·괄호 안) — 옵션(-x)은 뺀다.
      // 따옴표 안의 * ? [ { 는 글자지만, / 가 든 조각(glob.glob('~/x/*'))은 와일드카드로 본다
      const pieces = [...new Set(words.map(sub).flatMap((w) => [w, ...w.split(/[=<>|;&()`'",\s]/)])
        .map((x) => x.replace(/^[A-Za-z_]\w*=/, '').trim()).filter((x) => x && !x.startsWith('-') && x !== '/')
        .map((x) => (x.includes('/') ? unq(x) : x)))];
      const segs = cmd.split(/\|\||&&|[|;&\n]/).map((seg) => shellWords(seg)[0]).filter(Boolean);
      // 명령 치환·프로세스 치환이 있으면 안에서 무엇이든 돌 수 있다 — echo "$(cat 원문)" 은 이름 보기가 아니다
      const namesOnly = !/\$\(|`|[<>]\(/.test(cmd) && segs.length > 0 && segs.every((c) => NAMES_ONLY.has(path.basename(unq(c))));

      // 1) 글자 검사 — 셸이 풀어 쓴 단어(따옴표 이어 붙이기·\ 이스케이프 풀림)와 원래 명령 어디에든 원문 파일 이름·보호 폴더 경로가 보이면
      const texts = [fold(cmd.replace(/\\(.)/g, '$1')), fold(unq(pieces.join('\n')))];
      if (!namesOnly) for (const r of raws) if (r.base.length >= 4 && texts.some((x) => x.includes(r.base))) deny(r, '명령에 그 파일 이름이 들어 있음');
      for (const d of userDirs) for (const f of d.forms) for (const x of texts) {
        const i = x.indexOf(f);
        if (i >= 0 && /^($|[/\s"'`)\]}])/.test(x.slice(i + f.length))) deny(d, '명령에 그 폴더 경로가 들어 있음');
      }

      // 2) 경로 검사 — cd 로 옮겨 간 폴더도 상대 경로의 기준으로 (cd ~/Documents && cat 인사/a.txt)
      const bases = [cwd];
      words.forEach((w, i) => { if ((w === 'cd' || w === 'pushd') && words[i + 1]) bases.push(expand(sub(words[i + 1]), cwd)); });
      const recContent = CONTENT_REC.test(cmd);
      const recNames = !recContent && NAME_REC.test(cmd);
      // 재귀로 훑는 명령의 기준 폴더 아래에 보호 대상이 있나 — 내용을 읽으면 원문 파일까지, 이름만 보면 보호 폴더만
      const under = (p) => (recContent ? ancestorOf(p) : recNames ? ancestorDirOf(p) : null);
      for (const w of pieces) {
        for (const b of bases) {
          // 와일드카드·중괄호는 실제 파일로 펼쳐서 본다 (인?/a.txt · 인[사] · {인사,x} · *쓰기.txt · $(ls -d 인*))
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
          const a = under(p);
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
      // 경로를 준 명령(find ~/Desktop)은 위에서 그 경로로 판단했다. 와일드카드로 시작하는 단어(*/*.txt)는 경로를 준 것으로 보지 않는다
      const hasPathArg = pieces.some((w) => { const c = w.replace(/[*?[{].*$/, ''); return /[/~]/.test(c) || c === '.' || c === '..'; });
      if ((recContent || recNames) && !hasPathArg) for (const b of bases) { const a = under(key(b)); if (a) deny(a, `작업 폴더(${tilde(b)}) 아래를 재귀로 훑는 명령인데 그 아래에 보호 대상이 있음`, { scope: true }); }
      break;
    }
  }
}
